import { getGstInvoiceById } from "./invoice";
import { getGstNoteById } from "./notes";
import type { GstServiceResult } from "./types";

export interface GstPdfRenderPayload {
  gstDocumentId: string;
  documentNumber: string;
  html: string;
  metadata: {
    generatedAt: string;
    renderer: "GST_HTML_RENDERER_V3";
    templateType: "invoice" | "credit_note" | "debit_note";
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function asAmount(value: unknown): string {
  return Number(value || 0).toFixed(2);
}

function formatDate(value: unknown): string {
  const d = new Date(String(value || ""));
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function asText(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export async function renderGstPdf(gstDocumentId: string): Promise<GstServiceResult<GstPdfRenderPayload>> {
  const invoiceResult = await getGstInvoiceById(gstDocumentId);
  const documentResult = invoiceResult.ok ? invoiceResult : await getGstNoteById(gstDocumentId);

  if (!documentResult.ok || !documentResult.data) {
    return { ok: false, error: documentResult.error || "GST document not found" };
  }

  const doc = documentResult.data;
  const templateType = String(doc.documentType || "TAX_INVOICE") === "CREDIT_NOTE"
    ? "credit_note"
    : String(doc.documentType || "TAX_INVOICE") === "DEBIT_NOTE"
    ? "debit_note"
    : "invoice";

  const title = templateType === "invoice" ? "Tax Invoice" : templateType === "credit_note" ? "Credit Note" : "Debit Note";
  const lines = Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>) : [];
  const snapshot = (doc.jsonSnapshot || {}) as Record<string, unknown>;
  const seller = (snapshot.settings || {}) as Record<string, unknown>;
  const buyer = (snapshot.buyer || {}) as Record<string, unknown>;
  const metadata = (doc.metadata || {}) as Record<string, unknown>;
  const classification = (snapshot.classification || {}) as Record<string, unknown>;

  const supplierName = asText(seller.legalName, "Supplier");
  const supplierStateCode = asText(seller.stateCode);
  const buyerName = asText(buyer.legalName, "Customer");
  const placeOfSupply = asText(doc.placeOfSupplyStateCode || classification.placeOfSupplyStateCode || supplierStateCode, supplierStateCode);
  const orderNumber = asText(doc.shopifyOrderName || doc.sourceOrderNumber);
  const orderDate = formatDate(metadata.orderCreatedAt || doc.documentDate);
  const declaration = asText(metadata.declarationText || seller.declarationText);
  const footer = asText(metadata.footerText || seller.footerText, "This is a system generated GST document.");
  const signature = asText(metadata.signatureName || seller.authorizedSignatory);

  const rows = lines
    .map(
      (line) => {
      const description = String(line.description || "");
      const [maybeSku, maybeTitle] = description.split("•").map((part) => part.trim());
      const sku = maybeTitle ? maybeSku : "";
      const lineDescription = maybeTitle || description;
      return `<tr>
      <td>${escapeHtml(String(line.lineNumber || ""))}</td>
      <td>${escapeHtml(sku)}</td>
      <td>${escapeHtml(lineDescription)}</td>
      <td>${escapeHtml(String(line.hsnOrSac || ""))}</td>
      <td>${escapeHtml(String(line.quantity || ""))}</td>
      <td>${asAmount(Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discount || 0))}</td>
      <td>${asAmount(line.taxableAmount)}</td>
      <td>${asAmount(line.taxRate)}</td>
      <td>${asAmount(line.cgstAmount)}</td>
      <td>${asAmount(line.sgstAmount)}</td>
      <td>${asAmount(line.igstAmount)}</td>
      <td>${asAmount(line.lineTotal)}</td>
    </tr>`;
    },
    )
    .join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(String(doc.documentNumber || ""))}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, sans-serif; padding: 0; color: #111; font-size: 12px; }
      .brand-header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; }
      .company { font-size:18px; font-weight:bold; }
      .sub { font-size:12px; color:#555; }
      .meta-grid { display:grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 8px 0 14px; }
      .block { border: 1px solid #ddd; border-radius: 6px; padding: 8px; min-height: 64px; }
      .footer { margin-top:18px; font-size:11px; color:#555; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; }
      th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
      .totals { width: 380px; margin-left: auto; margin-top: 12px; }
      .totals td { border: 0; padding: 4px 0; }
      .signature { margin-top: 24px; text-align: right; }
    </style>
  </head>
  <body>

    <div class="brand-header">
      <div>
        <div class="company">${escapeHtml(supplierName)}</div>
        <div class="sub">${escapeHtml(asText(seller.tradeName))}</div>
        <div class="sub">GSTIN: ${escapeHtml(String(seller.gstin || ""))}</div>
        <div class="sub">State: ${escapeHtml(supplierStateCode)}</div>
      </div>
      <div>
        <div><strong>${title}</strong></div>
        <div>Invoice: ${escapeHtml(String(doc.documentNumber || ""))}</div>
        <div>Date: ${formatDate(doc.documentDate)}</div>
        <div>Order No: ${escapeHtml(orderNumber)}</div>
        <div>Order Date: ${escapeHtml(orderDate)}</div>
        <div>Place of Supply: ${escapeHtml(placeOfSupply)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="block">
        <strong>Supplier</strong>
        <div>${escapeHtml(supplierName)}</div>
        <div>GSTIN: ${escapeHtml(asText(seller.gstin))}</div>
        <div>State Code: ${escapeHtml(supplierStateCode)}</div>
      </div>
      <div class="block">
        <strong>Buyer</strong>
        <div>${escapeHtml(buyerName)}</div>
        <div>GSTIN: ${escapeHtml(asText(buyer.gstin, "UNREGISTERED"))}</div>
        <div>State Code: ${escapeHtml(asText(buyer.stateCode, placeOfSupply))}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>#</th><th>SKU</th><th>Description</th><th>HSN</th><th>Qty</th><th>Gross</th><th>Taxable</th><th>GST %</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <table class="totals">
      <tr><td>Taxable</td><td>${asAmount(doc.taxableAmount)}</td></tr>
      <tr><td>CGST</td><td>${asAmount(doc.cgstAmount)}</td></tr>
      <tr><td>SGST</td><td>${asAmount(doc.sgstAmount)}</td></tr>
      <tr><td>IGST</td><td>${asAmount(doc.igstAmount)}</td></tr>
      <tr><td>CESS</td><td>${asAmount(doc.cessAmount)}</td></tr>
      <tr><td><strong>Total</strong></td><td><strong>${asAmount(doc.totalAmount)}</strong></td></tr>
    </table>

    <div class="footer">
      ${declaration ? `<div><strong>Declaration:</strong> ${escapeHtml(declaration)}</div>` : ""}
      <div>${escapeHtml(footer)}</div>
    </div>
    <div class="signature">
      ${signature ? `<div>For ${escapeHtml(supplierName)}</div><div style="margin-top:16px;">${escapeHtml(signature)}</div>` : ""}
    </div>

  </body>
</html>`;

  return {
    ok: true,
    data: {
      gstDocumentId,
      documentNumber: String(doc.documentNumber || ""),
      html,
      metadata: {
        generatedAt: new Date().toISOString(),
        renderer: "GST_HTML_RENDERER_V3",
        templateType,
      },
    },
  };
}
