import { inflateSync, deflateSync } from "node:zlib";
import { buildGstInvoiceRenderModel } from "./pdf";
import type { GstInvoiceRenderModel } from "./pdf";
import type { GstServiceResult } from "./types";
import { gstPerfLog, gstPerfNow } from "./perf";

type PdfImage = {
  name: string;
  width: number;
  height: number;
  colorSpace: "/DeviceRGB" | "/DeviceGray";
  bitsPerComponent: number;
  data: Buffer;
  filter: "/FlateDecode" | "/DCTDecode";
  smask?: Omit<PdfImage, "name" | "smask">;
};

function escapePdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

// Helvetica glyph advance widths (per 1000 em, from the AFM metrics). Used to measure
// strings for accurate right-alignment - a crude average factor under-measures uppercase /
// digit-heavy text like a GSTIN and lets it spill past the right margin.
const HELVETICA_WIDTHS: Record<string, number> = (() => {
  const w: Record<string, number> = {};
  const put = (chars: string, width: number) => {
    for (const ch of chars) w[ch] = width;
  };
  put(" ", 278);
  put("0123456789", 556);
  w.A = 667; w.B = 667; w.C = 722; w.D = 722; w.E = 667; w.F = 611; w.G = 778; w.H = 722;
  w.I = 278; w.J = 500; w.K = 667; w.L = 556; w.M = 833; w.N = 722; w.O = 778; w.P = 667;
  w.Q = 778; w.R = 722; w.S = 667; w.T = 611; w.U = 722; w.V = 667; w.W = 944; w.X = 667;
  w.Y = 667; w.Z = 611;
  w.a = 556; w.b = 556; w.c = 500; w.d = 556; w.e = 556; w.f = 278; w.g = 556; w.h = 556;
  w.i = 222; w.j = 222; w.k = 500; w.l = 222; w.m = 833; w.n = 556; w.o = 556; w.p = 556;
  w.q = 556; w.r = 333; w.s = 500; w.t = 278; w.u = 556; w.v = 500; w.w = 722; w.x = 500;
  w.y = 500; w.z = 500;
  put(".,:;'!", 278);
  w["|"] = 260; w["-"] = 333;
  put("()[]{}", 333);
  w["#"] = 556; w["$"] = 556; w["%"] = 889; w["&"] = 667; w["*"] = 389; w["+"] = 584;
  w["="] = 584; w["?"] = 556; w["@"] = 1015; w["_"] = 556; w["/"] = 278;
  return w;
})();

// Bold is a touch wider than regular; over-measuring slightly only nudges right-aligned
// text left (safe) whereas under-measuring overflows, so we scale rather than carry a
// second table.
function measureText(text: string, size: number, bold = false): number {
  let units = 0;
  for (const ch of String(text || "")) units += HELVETICA_WIDTHS[ch] ?? 556;
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

function wrapText(value: string, maxLen: number): string[] {
  const text = String(value || "").trim();
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxLen && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawText(commands: string[], x: number, y: number, text: string, size = 9, bold = false): void {
  commands.push("BT");
  commands.push(`/${bold ? "F2" : "F1"} ${size} Tf`);
  commands.push(`${x.toFixed(2)} ${y.toFixed(2)} Td`);
  commands.push(`(${escapePdfText(text)}) Tj`);
  commands.push("ET");
}

function drawBox(commands: string[], x: number, y: number, width: number, height: number): void {
  commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function dataUrlToBuffer(src: string | null): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(src || ""));
  if (!match) return null;
  return { mime: match[1].toLowerCase(), buffer: Buffer.from(match[2], "base64") };
}

function paeth(left: number, above: number, upperLeft: number): number {
  const p = left + above - upperLeft;
  const pa = Math.abs(p - left);
  const pb = Math.abs(p - above);
  const pc = Math.abs(p - upperLeft);
  if (pa <= pb && pa <= pc) return left;
  return pb <= pc ? above : upperLeft;
}

function parsePngImage(name: string, buffer: Buffer): PdfImage | null {
  if (buffer.length < 33 || buffer.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  const interlace = buffer[28];
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 6].includes(colorType)) return null;

  const chunks: Buffer[] = [];
  let cursor = 8;
  while (cursor + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString("ascii", cursor + 4, cursor + 8);
    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) return null;
    if (type === "IDAT") chunks.push(buffer.subarray(dataStart, dataEnd));
    if (type === "IEND") break;
    cursor = dataEnd + 4;
  }

  if (colorType !== 6) {
    return {
      name,
      width,
      height,
      colorSpace: colorType === 0 ? "/DeviceGray" : "/DeviceRGB",
      bitsPerComponent: bitDepth,
      data: Buffer.concat(chunks),
      filter: "/FlateDecode",
    };
  }

  const inflated = inflateSync(Buffer.concat(chunks));
  const channels = 4;
  const stride = width * channels;
  const rgbRows: Buffer[] = [];
  const alphaRows: Buffer[] = [];
  let previous = Buffer.alloc(stride);
  let offset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[offset];
    offset += 1;
    const raw = Buffer.from(inflated.subarray(offset, offset + stride));
    offset += stride;
    const row = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const left = i >= channels ? row[i - channels] : 0;
      const above = previous[i] || 0;
      const upperLeft = i >= channels ? previous[i - channels] || 0 : 0;
      const value = raw[i];
      row[i] = (value + (filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0)) & 0xff;
    }
    const rgb = Buffer.alloc(1 + width * 3);
    const alpha = Buffer.alloc(1 + width);
    for (let x = 0; x < width; x += 1) {
      const source = x * 4;
      const target = 1 + x * 3;
      rgb[target] = row[source];
      rgb[target + 1] = row[source + 1];
      rgb[target + 2] = row[source + 2];
      alpha[1 + x] = row[source + 3];
    }
    rgbRows.push(rgb);
    alphaRows.push(alpha);
    previous = row;
  }

  return {
    name,
    width,
    height,
    colorSpace: "/DeviceRGB",
    bitsPerComponent: bitDepth,
    data: deflateSync(Buffer.concat(rgbRows)),
    filter: "/FlateDecode",
    smask: {
      width,
      height,
      colorSpace: "/DeviceGray",
      bitsPerComponent: bitDepth,
      data: deflateSync(Buffer.concat(alphaRows)),
      filter: "/FlateDecode",
    },
  };
}

function parseJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function parsePdfImage(name: string, src: string | null): PdfImage | null {
  const data = dataUrlToBuffer(src);
  if (!data) return null;
  if (data.mime === "image/png") return parsePngImage(name, data.buffer);
  if (data.mime === "image/jpeg" || data.mime === "image/jpg") {
    const dimensions = parseJpegDimensions(data.buffer);
    if (!dimensions) return null;
    return { name, width: dimensions.width, height: dimensions.height, colorSpace: "/DeviceRGB", bitsPerComponent: 8, data: data.buffer, filter: "/DCTDecode" };
  }
  return null;
}

function drawImage(commands: string[], image: PdfImage | null, x: number, y: number, maxWidth: number, maxHeight: number): boolean {
  if (!image) return false;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  commands.push("q");
  commands.push(`${width.toFixed(2)} 0 0 ${height.toFixed(2)} ${(x + (maxWidth - width) / 2).toFixed(2)} ${y.toFixed(2)} cm`);
  commands.push(`/${image.name} Do`);
  commands.push("Q");
  return true;
}
function buildStyledPdf(model: GstInvoiceRenderModel): Buffer {
  const commands: string[] = [];
  const images = [
    parsePdfImage("ImHeaderLogo", model.branding.headerLogoSrc),
    parsePdfImage("ImFooterLogo", model.branding.footerLogoSrc),
  ].filter((image): image is PdfImage => Boolean(image));
  const headerLogo = images.find((image) => image.name === "ImHeaderLogo") || null;
  const footerLogo = images.find((image) => image.name === "ImFooterLogo") || null;
  // A4 PORTRAIT. The common part (header, party boxes, totals) keeps its design, just
  // reflowed to portrait width. The line-item table is redesigned to avoid cramping: a
  // wide "Item Description" column that wraps, with SKU / HSN / variant / per-line tax
  // breakup on a compact sub-line instead of one narrow column each.
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 24;
  const contentWidth = pageWidth - margin * 2;
  const left = margin;
  const right = pageWidth - margin;
  const innerLeft = left + 6;
  const cfg = model.templateConfig;

  const drawRight = (xRight: number, yPos: number, text: string, size = 7, bold = false) =>
    drawText(commands, Math.max(innerLeft, xRight - measureText(text, size, bold)), yPos, text, size, bold);

  drawBox(commands, margin, margin, contentWidth, pageHeight - margin * 2);
  let y = pageHeight - margin - 6;

  if (cfg.showHeaderLogo) {
    if (!drawImage(commands, headerLogo, pageWidth / 2 - 90, y - 26, 180, 24)) {
      drawText(commands, pageWidth / 2 - 28, y - 16, "bigonbuy", 11);
    }
    y -= 30;
  }
  drawText(commands, innerLeft, y - 10, `${model.title} | Original for Recipient`, 10, true);
  drawRight(right - 8, y - 10, `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`, 8);
  y -= 20;
  drawText(commands, innerLeft, y - 10, model.supplier.tradeName || model.supplier.name, 9, true);
  y -= 13;
  drawText(commands, innerLeft, y - 10, `Invoice: ${model.documentNumber} | Date: ${model.documentDate}`, 8);
  drawRight(right - 8, y - 10, `Place of Supply: ${model.placeOfSupply}`, 8);
  y -= 12;
  drawText(commands, innerLeft, y - 10, `Order: ${model.orderNumber} | Order Date: ${model.orderDate}`, 8);
  y -= 18;

  const boxGap = 8;
  const partyW = (contentWidth - 8 - boxGap * 2) / 3;
  const partyH = 98;
  const partyX = [left + 4, left + 4 + partyW + boxGap, left + 4 + (partyW + boxGap) * 2];
  const partyTop = y;
  const partyBottom = y - partyH;
  for (const x of partyX) drawBox(commands, x, partyBottom, partyW, partyH);
  const drawParty = (x: number, title: string, lines: string[]) => {
    let yy = partyTop - 12;
    drawText(commands, x + 5, yy, title, 8, true);
    yy -= 11;
    for (const line of lines) {
      for (const w of wrapText(line, 32)) {
        if (yy < partyBottom + 6) return;
        drawText(commands, x + 5, yy, w, 6.5);
        yy -= 8;
      }
    }
  };
  drawParty(partyX[0], "BILLED TO", [
    model.buyer.name || "Customer",
    `GSTIN: ${model.buyer.gstin || "UNREGISTERED"}`,
    ...model.buyer.lines,
    `Phone: ${model.buyer.phone || "-"}`,
    `Email: ${model.buyer.email || "-"}`,
  ]);
  drawParty(partyX[1], "SHIP TO", [
    model.shipping.name || model.buyer.name || "Customer",
    ...model.shipping.lines,
    `Phone: ${model.shipping.phone || model.buyer.phone || "-"}`,
    `Email: ${model.shipping.email || model.buyer.email || "-"}`,
  ]);
  drawParty(partyX[2], "SUPPLIER", [
    model.supplier.name,
    `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`,
    ...model.supplier.lines,
    `Phone: ${model.supplier.phone || "-"}`,
    `Email: ${model.supplier.email || "-"}`,
  ]);
  y = partyBottom - 16;

  type RenderRowKey = keyof GstInvoiceRenderModel["rows"][number];
  const tableLeft = left + 4;
  const tableWidth = contentWidth - 8;
  const mainCols: Array<{ key: RenderRowKey; title: string; w: number; align: "l" | "r" }> = [
    { key: "lineNumber", title: "#", w: 0.05, align: "l" },
    { key: "description", title: "Item Description", w: 0.43, align: "l" },
    { key: "quantity", title: "Qty", w: 0.08, align: "r" },
    { key: "taxable", title: "Taxable", w: 0.16, align: "r" },
    { key: "gstRate", title: "GST%", w: 0.08, align: "r" },
    { key: "total", title: "Total", w: 0.2, align: "r" },
  ];
  const colX: number[] = [];
  let acc = tableLeft;
  for (const col of mainCols) {
    colX.push(acc);
    acc += col.w * tableWidth;
  }
  const colRight = (i: number) => (i + 1 < mainCols.length ? colX[i + 1] : tableLeft + tableWidth);

  const headerH = 16;
  drawBox(commands, tableLeft, y - headerH, tableWidth, headerH);
  mainCols.forEach((col, i) => {
    if (col.align === "r") drawRight(colRight(i) - 3, y - 11, col.title, 7.5, true);
    else drawText(commands, colX[i] + 3, y - 11, col.title, 7.5, true);
  });
  y -= headerH;

  const descChars = Math.max(24, Math.floor((mainCols[1].w * tableWidth) / 3.6));
  const bottomLimit = 150;
  for (const row of model.rows) {
    if (y < bottomLimit) break;
    const descLines = wrapText(row.description, descChars);
    const metaParts: string[] = [];
    if (cfg.showSku && row.sku) metaParts.push(`SKU: ${row.sku}`);
    if (cfg.showHsn && row.hsn) metaParts.push(`HSN: ${row.hsn}`);
    if (cfg.showVariant && row.variant) metaParts.push(`Variant: ${row.variant}`);
    if (cfg.showTaxBreakup) metaParts.push(`CGST: ${row.cgst}`, `SGST: ${row.sgst}`, `IGST: ${row.igst}`);
    const metaLines = metaParts.length ? wrapText(metaParts.join("    "), Math.floor(tableWidth / 3.2)) : [];
    const rowHeight = Math.max(1, descLines.length) * 9 + metaLines.length * 8 + 9;
    if (y - rowHeight < bottomLimit) break;
    const rowTop = y;
    const rowBottom = y - rowHeight;
    drawBox(commands, tableLeft, rowBottom, tableWidth, rowHeight);
    drawText(commands, colX[0] + 3, rowTop - 10, row.lineNumber, 7.5);
    let dy = rowTop - 10;
    for (const w of descLines) {
      drawText(commands, colX[1] + 3, dy, w, 7.5);
      dy -= 9;
    }
    for (const w of metaLines) {
      drawText(commands, colX[1] + 3, dy, w, 6.5);
      dy -= 8;
    }
    drawRight(colRight(2) - 3, rowTop - 10, row.quantity, 7.5);
    drawRight(colRight(3) - 3, rowTop - 10, row.taxable, 7.5);
    drawRight(colRight(4) - 3, rowTop - 10, `${row.gstRate}%`, 7.5);
    drawRight(colRight(5) - 3, rowTop - 10, row.total, 7.5);
    y = rowBottom;
  }

  const totalLines = [
    `Taxable: ${model.totals.taxable}`,
    ...(cfg.showTaxBreakup
      ? [`CGST: ${model.totals.cgst}`, `SGST: ${model.totals.sgst}`, `IGST: ${model.totals.igst}`, `CESS: ${model.totals.cess}`]
      : []),
    `Grand Total: ${model.totals.total}`,
  ];
  const totalsW = 220;
  const totalsX = right - totalsW;
  const totalsH = totalLines.length * 12 + 10;
  y -= 10;
  drawBox(commands, totalsX, y - totalsH, totalsW, totalsH);
  let totalY = y - 14;
  totalLines.forEach((line, index) => {
    const isGrandTotal = index === totalLines.length - 1;
    drawText(commands, totalsX + 8, totalY, line, isGrandTotal ? 9 : 8, isGrandTotal);
    totalY -= 12;
  });
  y -= totalsH + 8;

  if (cfg.showAmountInWords) {
    for (const w of wrapText(`Amount in Words: ${model.amountInWords}`, 95)) {
      drawText(commands, innerLeft, y - 9, w, 7);
      y -= 9;
    }
  }
  if (cfg.showDeclaration && model.declaration) {
    for (const w of wrapText(`Declaration: ${model.declaration}`, 95)) {
      drawText(commands, innerLeft, y - 9, w, 7);
      y -= 9;
    }
  }
  if (cfg.showFooterNote) {
    drawText(commands, innerLeft, margin + 16, model.footer || "This is a system generated GST document.", 7);
  }
  if (cfg.showFooterLogo && !drawImage(commands, footerLogo, right - 120, margin + 8, 110, 22)) {
    drawText(commands, right - 120, margin + 16, model.supplier.tradeName || model.supplier.name, 8);
  }
  if (model.signature) {
    drawText(commands, right - 170, margin + 34, `For ${model.supplier.name}`, 7);
    drawText(commands, right - 170, margin + 22, model.signature, 7);
  }

  const stream = commands.join("\n");

  const xObjectEntries: string[] = [];
  const objectBuffers: Buffer[] = [
    Buffer.from("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "utf8"),
    Buffer.from("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n", "utf8"),
  ];
  const imageObjects: Buffer[] = [];
  let nextObjectId = 7;

  for (const image of images) {
    let smaskRef = "";
    if (image.smask) {
      const smaskObjectId = nextObjectId;
      nextObjectId += 1;
      imageObjects.push(buildImageObject(smaskObjectId, image.smask));
      smaskRef = ` /SMask ${smaskObjectId} 0 R`;
    }
    const imageObjectId = nextObjectId;
    nextObjectId += 1;
    xObjectEntries.push(`/${image.name} ${imageObjectId} 0 R`);
    imageObjects.push(buildImageObject(imageObjectId, image, smaskRef));
  }

  const xObjects = xObjectEntries.length ? ` /XObject << ${xObjectEntries.join(" ")} >>` : "";
  objectBuffers.push(Buffer.from(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R /F2 6 0 R >>${xObjects} >> >> endobj\n`, "utf8"));
  objectBuffers.push(Buffer.from("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n", "utf8"));
  objectBuffers.push(Buffer.from(`5 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj\n`, "utf8"));
  objectBuffers.push(Buffer.from("6 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj\n", "utf8"));
  objectBuffers.push(...imageObjects);

  const header = Buffer.from("%PDF-1.4\n", "utf8");
  let offset = header.byteLength;
  const xref: number[] = [0];
  for (const objectBuffer of objectBuffers) {
    xref.push(offset);
    offset += objectBuffer.byteLength;
  }
  const body = Buffer.concat(objectBuffers);
  const xrefStart = header.byteLength + body.byteLength;
  const xrefTable = [
    "xref",
    `0 ${objectBuffers.length + 1}`,
    "0000000000 65535 f ",
    ...xref.slice(1).map((num) => `${num.toString().padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objectBuffers.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefStart),
    "%%EOF",
  ].join("\n");

  return Buffer.concat([header, body, Buffer.from(xrefTable, "utf8")]);
}

function buildImageObject(objectId: number, image: Omit<PdfImage, "name" | "smask">, extraDictionary = ""): Buffer {
  const decodeParms = image.filter === "/FlateDecode"
    ? ` /DecodeParms << /Predictor 15 /Colors ${image.colorSpace === "/DeviceRGB" ? 3 : 1} /BitsPerComponent ${image.bitsPerComponent} /Columns ${image.width} >>`
    : "";
  const dictionary = `${objectId} 0 obj << /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace ${image.colorSpace} /BitsPerComponent ${image.bitsPerComponent} /Filter ${image.filter}${decodeParms}${extraDictionary} /Length ${image.data.byteLength} >> stream\n`;
  return Buffer.concat([Buffer.from(dictionary, "utf8"), image.data, Buffer.from("\nendstream endobj\n", "utf8")]);
}

export async function renderGstInvoicePdfBuffer(gstDocumentId: string): Promise<GstServiceResult<{ documentNumber: string; buffer: Buffer }>> {
  const bufferStartedAtMs = gstPerfNow();
  const modelResult = await buildGstInvoiceRenderModel(gstDocumentId);
  if (!modelResult.ok || !modelResult.data) {
    return { ok: false, error: modelResult.error || "GST invoice not found" };
  }

  const model = modelResult.data;
  const buffer = buildStyledPdf(model);
  gstPerfLog("gst.pdf.binaryBuffer", bufferStartedAtMs, { gstDocumentId, rowCount: model.rows.length, bytes: buffer.byteLength });
  return { ok: true, data: { documentNumber: model.documentNumber, buffer } };
}
