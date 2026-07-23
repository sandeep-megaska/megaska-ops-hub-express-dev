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

function drawText(commands: string[], x: number, y: number, text: string, size = 9): void {
  commands.push("BT");
  commands.push(`/F1 ${size} Tf`);
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
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 18;
  const contentWidth = pageWidth - margin * 2;
  const tableStartX = margin + 4;
  const right = pageWidth - margin;

  drawBox(commands, margin, margin, contentWidth, pageHeight - margin * 2);
  if (model.templateConfig.showHeaderLogo && !drawImage(commands, headerLogo, pageWidth / 2 - 110, pageHeight - 38, 220, 28)) {
    drawText(commands, pageWidth / 2 - 34, pageHeight - 26, "bigonbuy", 10);
  }
  drawText(commands, margin + 8, pageHeight - 40, `${model.title} | Original for Recipient`, 9);
  drawText(commands, right - 220, pageHeight - 40, `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`, 8);
  drawText(commands, margin + 8, pageHeight - 52, `${model.supplier.tradeName || model.supplier.name}`, 9);
  drawText(commands, margin + 8, pageHeight - 64, `Invoice: ${model.documentNumber} | Date: ${model.documentDate}`, 8);
  drawText(commands, margin + 8, pageHeight - 75, `Order: ${model.orderNumber} | Order Date: ${model.orderDate}`, 8);
  drawText(commands, right - 220, pageHeight - 75, `Place of Supply: ${model.placeOfSupply}`, 8);

  const boxTop = pageHeight - 88;
  const boxHeight = 90;
  const boxGap = 8;
  const boxWidth = (contentWidth - boxGap * 2 - 8) / 3;
  const firstX = margin + 4;
  const secondX = firstX + boxWidth + boxGap;
  const thirdX = secondX + boxWidth + boxGap;
  const boxY = boxTop - boxHeight;
  drawBox(commands, firstX, boxY, boxWidth, boxHeight);
  drawBox(commands, secondX, boxY, boxWidth, boxHeight);
  drawBox(commands, thirdX, boxY, boxWidth, boxHeight);

  const drawParty = (x: number, title: string, lines: string[]) => {
    let y = boxTop - 14;
    drawText(commands, x + 6, y, title, 8);
    y -= 10;
    for (const line of lines.slice(0, 6)) {
      drawText(commands, x + 6, y, line, 7);
      y -= 9;
      if (y < boxY + 8) break;
    }
  };

  drawParty(firstX, "BILLED TO", [
    model.buyer.name || "Customer",
    `GSTIN: ${model.buyer.gstin || "UNREGISTERED"}`,
    ...model.buyer.lines,
    `Phone: ${model.buyer.phone || "-"}`,
    `Email: ${model.buyer.email || "-"}`,
  ]);
  drawParty(secondX, "SHIP TO", [
    model.shipping.name || model.buyer.name || "Customer",
    ...model.shipping.lines,
    `Phone: ${model.shipping.phone || model.buyer.phone || "-"}`,
    `Email: ${model.shipping.email || model.buyer.email || "-"}`,
  ]);
  drawParty(thirdX, "SUPPLIER", [
    model.supplier.name,
    `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`,
    ...model.supplier.lines,
    `Phone: ${model.supplier.phone || "-"}`,
    `Email: ${model.supplier.email || "-"}`,
  ]);

  const tableTop = boxY - 10;
  const totalTableWidth = contentWidth - 8;
  type RenderRowKey = keyof GstInvoiceRenderModel["rows"][number];
  const column = (key: RenderRowKey, title: string, width: number) => ({ key, title, width });
  const columns: Array<{ key: RenderRowKey; title: string; width: number }> = [
    column("lineNumber", "#", 0.04),
    ...(model.templateConfig.showSku ? [column("sku", "SKU", 0.13)] : []),
    ...(model.templateConfig.showProductTitle ? [column("description", "Item", 0.27)] : []),
    ...(model.templateConfig.showVariant ? [column("variant", "Variant", 0.1)] : []),
    ...(model.templateConfig.showHsn ? [column("hsn", "HSN", 0.09)] : []),
    column("quantity", "Qty", 0.05),
    column("taxable", "Taxable", 0.1),
    ...(model.templateConfig.showTaxBreakup
      ? [
          column("gstRate", "GST%", 0.06),
          column("cgst", "CGST", 0.07),
          column("sgst", "SGST", 0.07),
          column("igst", "IGST", 0.07),
        ]
      : []),
    column("total", "Total", 0.09),
  ];
  const widthTotal = columns.reduce((sum, column) => sum + column.width, 0);
  const colWidths = columns.map((column, index) => {
    const pixels = Math.floor((column.width / widthTotal) * totalTableWidth);
    if (index !== columns.length - 1) return pixels;
    const consumed = columns.slice(0, -1).reduce((sum, part) => sum + Math.floor((part.width / widthTotal) * totalTableWidth), 0);
    return totalTableWidth - consumed;
  });
  const colTitles = columns.map((column) => column.title);
  let colX = tableStartX;
  for (let i = 0; i < colWidths.length; i += 1) {
    drawBox(commands, colX, tableTop - 14, colWidths[i], 14);
    drawText(commands, colX + 1.5, tableTop - 10, colTitles[i], 7);
    colX += colWidths[i];
  }

  let currentY = tableTop - 14;
  for (const row of model.rows.slice(0, 16)) {
    const rowLines = wrapText(row.description, 44);
    const skuLines = wrapText(row.sku, 16);
    const maxLines = Math.max(rowLines.length || 1, skuLines.length || 1);
    const rowHeight = Math.max(12, maxLines * 8 + 3);
    currentY -= rowHeight;
    if (currentY < 120) break;
    colX = tableStartX;
    for (let i = 0; i < colWidths.length; i += 1) {
      drawBox(commands, colX, currentY, colWidths[i], rowHeight);
      colX += colWidths[i];
    }
    const cells = columns.map((column) => String(row[column.key] || ""));
    colX = tableStartX;
    for (let i = 0; i < cells.length; i += 1) {
      drawText(commands, colX + 1.5, currentY + rowHeight - 8, cells[i], 7);
      colX += colWidths[i];
    }
    if (rowLines.length > 1 || skuLines.length > 1) {
      const xForColumn = (key: RenderRowKey) => {
        const index = columns.findIndex((column) => column.key === key);
        if (index < 0) return null;
        return tableStartX + colWidths.slice(0, index).reduce((sum, width) => sum + width, 0) + 1.5;
      };
      const skuX = xForColumn("sku");
      const itemX = xForColumn("description");
      if (skuX !== null) {
        let rowLineY = currentY + rowHeight - 16;
        for (const text of skuLines.slice(1, 4)) {
          drawText(commands, skuX, rowLineY, text, 7);
          rowLineY -= 8;
        }
      }
      if (itemX !== null) {
        let rowLineY = currentY + rowHeight - 16;
        for (const text of rowLines.slice(1, 4)) {
          drawText(commands, itemX, rowLineY, text, 7);
          rowLineY -= 10;
        }
      }
    }
  }

  const totalsX = right - 205;
  const totalsY = currentY - 72;
  drawBox(commands, totalsX, totalsY, 190, 66);
  const totalLines = [
    `Taxable: ${model.totals.taxable}`,
    ...(model.templateConfig.showTaxBreakup
      ? [`CGST: ${model.totals.cgst}`, `SGST: ${model.totals.sgst}`, `IGST: ${model.totals.igst}`, `CESS: ${model.totals.cess}`]
      : []),
    `Grand Total: ${model.totals.total}`,
  ];
  let totalY = totalsY + 54;
  totalLines.forEach((line) => {
    drawText(commands, totalsX + 8, totalY, line, 8);
    totalY -= 9;
  });

  if (model.templateConfig.showAmountInWords) {
    drawText(commands, margin + 8, totalsY - 14, `Amount in Words: ${model.amountInWords}`, 7);
  }
  if (model.templateConfig.showDeclaration && model.declaration) {
    drawText(commands, margin + 8, totalsY - 25, `Declaration: ${model.declaration}`, 7);
  }
  if (model.templateConfig.showFooterNote) {
    drawText(commands, margin + 8, 30, model.footer || "This is a system generated GST document.", 7);
  }
  if (model.templateConfig.showFooterLogo && !drawImage(commands, footerLogo, right - 140, 24, 120, 24)) {
    drawText(commands, right - 140, 30, model.supplier.tradeName || model.supplier.name, 8);
  }
  if (model.signature) {
    drawText(commands, right - 180, 45, `For ${model.supplier.name}`, 7);
    drawText(commands, right - 180, 34, model.signature, 7);
  }

  const stream = commands.join("\n");

  const xObjectEntries: string[] = [];
  const objectBuffers: Buffer[] = [
    Buffer.from("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n", "utf8"),
    Buffer.from("2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n", "utf8"),
  ];
  const imageObjects: Buffer[] = [];
  let nextObjectId = 6;

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
  objectBuffers.push(Buffer.from(`3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >>${xObjects} >> >> endobj\n`, "utf8"));
  objectBuffers.push(Buffer.from("4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n", "utf8"));
  objectBuffers.push(Buffer.from(`5 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj\n`, "utf8"));
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
