import { buildGstInvoiceRenderModel } from "./pdf";
import type { GstServiceResult } from "./types";

function escapePdfText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function buildMinimalPdf(lines: string[]): Buffer {
  const contentLines: string[] = ["BT", "/F1 10 Tf", "14 TL", "40 800 Td"];
  lines.forEach((line, index) => {
    if (index > 0) contentLines.push("T*");
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });
  contentLines.push("ET");

  const stream = contentLines.join("\n");

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
  const rows = model.rows.map((row) => `${row.lineNumber}. ${row.description} | Qty ${row.quantity} | Taxable ${row.taxable} | Total ${row.total}`);
  const lines = [
    `GSTIN: ${model.supplier.gstin}`,
    `${model.title} | Original for Recipient`,
    `Invoice: ${model.documentNumber}  Date: ${model.documentDate}`,
    `Order: ${model.orderNumber}  Order Date: ${model.orderDate}`,
    `Place of Supply: ${model.placeOfSupply}`,
    "",
    `Billed To: ${model.buyer.name} (${model.buyer.gstin})`,
    ...model.buyer.lines,
    `Phone: ${model.buyer.phone || "-"} Email: ${model.buyer.email || "-"}`,
    "",
    `Ship To: ${model.shipping.name}`,
    ...model.shipping.lines,
    "",
    `Supplier: ${model.supplier.name} (${model.supplier.gstin})`,
    ...model.supplier.lines,
    `Phone: ${model.supplier.phone || "-"} Email: ${model.supplier.email || "-"}`,
    "",
    "Items:",
    ...rows,
    "",
    `Totals: Taxable ${model.totals.taxable}, CGST ${model.totals.cgst}, SGST ${model.totals.sgst}, IGST ${model.totals.igst}, CESS ${model.totals.cess}, GRAND ${model.totals.total}`,
    `Amount in words: ${model.amountInWords}`,
    model.declaration ? `Declaration: ${model.declaration}` : "",
    model.footer,
  ].filter(Boolean);

  return { ok: true, data: { documentNumber: model.documentNumber, buffer: buildMinimalPdf(lines) } };
}
