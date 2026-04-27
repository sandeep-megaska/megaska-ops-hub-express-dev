import { buildGstInvoiceRenderModel } from "./pdf";
import type { GstInvoiceRenderModel } from "./pdf";
import type { GstServiceResult } from "./types";

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

function buildStyledPdf(model: GstInvoiceRenderModel): Buffer {
  const commands: string[] = [];
  const pageWidth = 595;
  const pageHeight = 842;
  const margin = 22;
  const contentWidth = pageWidth - margin * 2;
  const tableStartX = margin + 4;
  const right = pageWidth - margin;

  drawBox(commands, margin, margin, contentWidth, pageHeight - margin * 2);
  drawText(commands, margin + 8, pageHeight - 36, `${model.title} | Original for Recipient`, 11);
  drawText(commands, right - 210, pageHeight - 36, `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`, 9);
  drawText(commands, margin + 8, pageHeight - 52, `${model.supplier.tradeName || model.supplier.name}`, 10);
  drawText(commands, margin + 8, pageHeight - 66, `Invoice: ${model.documentNumber} | Date: ${model.documentDate}`, 9);
  drawText(commands, margin + 8, pageHeight - 80, `Order: ${model.orderNumber} | Order Date: ${model.orderDate}`, 9);
  drawText(commands, right - 180, pageHeight - 80, `Place of Supply: ${model.placeOfSupply}`, 9);

  const boxTop = pageHeight - 98;
  const boxHeight = 118;
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
    drawText(commands, x + 6, y, title, 9);
    y -= 13;
    for (const line of lines.slice(0, 8)) {
      drawText(commands, x + 6, y, line, 8);
      y -= 11;
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
  drawParty(secondX, "SHIP TO", [model.shipping.name || model.buyer.name || "Customer", ...model.shipping.lines]);
  drawParty(thirdX, "SUPPLIER", [
    model.supplier.name,
    `GSTIN: ${model.supplier.gstin || "UNREGISTERED"}`,
    ...model.supplier.lines,
    `Phone: ${model.supplier.phone || "-"}`,
    `Email: ${model.supplier.email || "-"}`,
  ]);

  const tableTop = boxY - 14;
  const colWidths = [22, 62, 138, 44, 26, 54, 54, 34, 44, 44, 44];
  const colTitles = ["#", "SKU", "Item", "HSN", "Qty", "Taxable", "GST%", "CGST", "SGST", "IGST", "Total"];
  let colX = tableStartX;
  for (let i = 0; i < colWidths.length; i += 1) {
    drawBox(commands, colX, tableTop - 16, colWidths[i], 16);
    drawText(commands, colX + 2, tableTop - 12, colTitles[i], 8);
    colX += colWidths[i];
  }

  let currentY = tableTop - 16;
  for (const row of model.rows.slice(0, 14)) {
    const rowLines = wrapText(row.description, 30);
    const rowHeight = Math.max(14, rowLines.length * 10 + 4);
    currentY -= rowHeight;
    if (currentY < 180) break;
    colX = tableStartX;
    for (let i = 0; i < colWidths.length; i += 1) {
      drawBox(commands, colX, currentY, colWidths[i], rowHeight);
      colX += colWidths[i];
    }
    const cells = [row.lineNumber, row.sku, rowLines[0] || row.description, row.hsn, row.quantity, row.taxable, row.gstRate, row.cgst, row.sgst, row.igst, row.total];
    colX = tableStartX;
    for (let i = 0; i < cells.length; i += 1) {
      drawText(commands, colX + 2, currentY + rowHeight - 10, cells[i], 8);
      colX += colWidths[i];
    }
    if (rowLines.length > 1) {
      let rowLineY = currentY + rowHeight - 20;
      for (const text of rowLines.slice(1, 3)) {
        drawText(commands, tableStartX + colWidths[0] + colWidths[1] + 2, rowLineY, text, 8);
        rowLineY -= 10;
      }
    }
  }

  const totalsX = right - 205;
  const totalsY = currentY - 84;
  drawBox(commands, totalsX, totalsY, 190, 78);
  const totalLines = [
    `Taxable: ${model.totals.taxable}`,
    `CGST: ${model.totals.cgst}`,
    `SGST: ${model.totals.sgst}`,
    `IGST: ${model.totals.igst}`,
    `CESS: ${model.totals.cess}`,
    `Grand Total: ${model.totals.total}`,
  ];
  let totalY = totalsY + 64;
  totalLines.forEach((line) => {
    drawText(commands, totalsX + 8, totalY, line, 9);
    totalY -= 11;
  });

  drawText(commands, margin + 8, totalsY - 18, `Amount in Words: ${model.amountInWords}`, 8);
  if (model.declaration) {
    drawText(commands, margin + 8, totalsY - 32, `Declaration: ${model.declaration}`, 8);
  }
  drawText(commands, margin + 8, 42, model.footer || "This is a system generated GST document.", 8);
  if (model.signature) {
    drawText(commands, right - 180, 60, `For ${model.supplier.name}`, 8);
    drawText(commands, right - 180, 46, model.signature, 8);
  }

  const stream = commands.join("\n");

  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 4 0 R >> >> >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
    `5 0 obj << /Length ${Buffer.byteLength(stream, "utf8")} >> stream\n${stream}\nendstream endobj`,
  ];

  let offset = 9;
  const xref: number[] = [0];
  const body = objects
    .map((obj) => {
      xref.push(offset);
      offset += Buffer.byteLength(`${obj}\n`, "utf8");
      return `${obj}\n`;
    })
    .join("");

  const xrefStart = 9 + Buffer.byteLength(body, "utf8");
  const xrefTable = [
    "xref",
    `0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...xref.slice(1).map((num) => `${num.toString().padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefStart),
    "%%EOF",
  ].join("\n");

  return Buffer.from(`%PDF-1.4\n${body}${xrefTable}`, "utf8");
}

export async function renderGstInvoicePdfBuffer(gstDocumentId: string): Promise<GstServiceResult<{ documentNumber: string; buffer: Buffer }>> {
  const modelResult = await buildGstInvoiceRenderModel(gstDocumentId);
  if (!modelResult.ok || !modelResult.data) {
    return { ok: false, error: modelResult.error || "GST invoice not found" };
  }

  const model = modelResult.data;
  return { ok: true, data: { documentNumber: model.documentNumber, buffer: buildStyledPdf(model) } };
}
