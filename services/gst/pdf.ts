import { getGstInvoiceById } from "./invoice";
import { getGstNoteById } from "./notes";
import { getGstStatePrimaryNameByCode, resolveGstStateCode } from "./state-codes";
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

function formatStateDisplay(value: unknown, fallback = ""): string {
  const code = resolveGstStateCode(String(value ?? "").trim());
  if (!code) return fallback;
  const name = getGstStatePrimaryNameByCode(code);
  return name ? `${name} (${code})` : code;
}

function readFirstText(source: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const text = asText(source[key]);
    if (text) return text;
  }
  return "";
}

function buildSupplierAddress(seller: Record<string, unknown>): string[] {
  const line1 = readFirstText(seller, ["addressLine1", "address1", "registeredAddressLine1", "line1"]);
  const line2 = readFirstText(seller, ["addressLine2", "address2", "registeredAddressLine2", "line2"]);
  const city = readFirstText(seller, ["city", "town"]);
  const district = readFirstText(seller, ["district"]);
  const postalCode = readFirstText(seller, ["postalCode", "pincode", "zip"]);
  const state = formatStateDisplay(readFirstText(seller, ["stateCode", "state", "stateProvince"]));
  const country = readFirstText(seller, ["country", "countryName"]);

  return [line1, line2, [city, district].filter(Boolean).join(", "), [state, postalCode].filter(Boolean).join(" - "), country].filter(Boolean);
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
  const supplierTradeName = asText(seller.tradeName);
  const supplierStateCode = asText(seller.stateCode);
  const supplierStateDisplay = formatStateDisplay(supplierStateCode, supplierStateCode);
  const supplierAddressLines = buildSupplierAddress(seller);
  const buyerName = asText(buyer.legalName, "Customer");
  const placeOfSupplyCode = asText(doc.placeOfSupplyStateCode || classification.placeOfSupplyStateCode || supplierStateCode, supplierStateCode);
  const placeOfSupply = formatStateDisplay(placeOfSupplyCode, placeOfSupplyCode);
  const buyerStateDisplay = formatStateDisplay(asText(buyer.stateCode, placeOfSupplyCode), placeOfSupply);
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
      body { font-family: Arial, sans-serif; padding: 0; color: #111; font-size: 12px; margin: 0; }
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
      .no-print { margin-bottom: 10px; }
      .btn { border: 1px solid #888; background: #f5f5f5; border-radius: 4px; padding: 6px 10px; cursor: pointer; }
      .brand-line { font-size: 11px; color:#444; margin-top: 2px; }
      .page-wrap { width: 100%; max-width: 100%; }
      @media print {
        .no-print { display: none !important; }
        .brand-header { break-inside: avoid; }
        .meta-grid { break-inside: avoid; }
        table, tr, td, th { page-break-inside: avoid; }
      }
    </style>
  </head>
  <body>
    <div class="no-print">
      <button class="btn" onclick="window.print()">Download PDF</button>
    </div>
    <div class="page-wrap">

    <div class="brand-header">
      <div>
        <div class="company">${escapeHtml(supplierName)}</div>
        <div class="sub">${escapeHtml(supplierTradeName)}</div>
        <div class="brand-line">MEGASKA | www.megaska.com</div>
        <div class="sub">GSTIN: ${escapeHtml(String(seller.gstin || ""))}</div>
        <div class="sub">State: ${escapeHtml(supplierStateDisplay)}</div>
      </div>
      <div>
        <div><strong>${title}</strong></div>
        <div>Invoice: ${escapeHtml(String(doc.documentNumber || ""))}</div>
        <div>Date: ${formatDate(doc.documentDate)}</div>
        <div>Order No: ${escapeHtml(orderNumber)}</div>
        <div>Order Date: ${escapeHtml(orderDate)}</div>
        <div>Store: MEGASKA | www.megaska.com</div>
        <div>State: ${escapeHtml(supplierStateDisplay)}</div>
        <div>Place of Supply: ${escapeHtml(placeOfSupply)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="block">
        <strong>Supplier</strong>
        <div>${escapeHtml(supplierName)}</div>
        <div>${escapeHtml(supplierTradeName)}</div>
        <div>GSTIN: ${escapeHtml(asText(seller.gstin))}</div>
        <div>State: ${escapeHtml(supplierStateDisplay)}</div>
        ${supplierAddressLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
        <div>Website: www.megaska.com</div>
      </div>
      <div class="block">
        <strong>Buyer</strong>
        <div>${escapeHtml(buyerName)}</div>
        <div>GSTIN: ${escapeHtml(asText(buyer.gstin, "UNREGISTERED"))}</div>
        <div>State: ${escapeHtml(buyerStateDisplay)}</div>
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
