import { prisma } from "../db/prisma";
import { getGstInvoiceById } from "./invoice";
import { getGstNoteById } from "./notes";
import { getSingleShopifyOrderForGstSync } from "./shopify-runtime-admin";
import { getGstStatePrimaryNameByCode, resolveGstStateCode } from "./state-codes";
import type { GstServiceResult } from "./types";

export interface GstPdfRenderPayload {
  gstDocumentId: string;
  documentNumber: string;
  html: string;
  metadata: {
    generatedAt: string;
    renderer: "GST_HTML_RENDERER_V4";
    templateType: "invoice" | "credit_note" | "debit_note";
  };
}
function publicAssetUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

  return base ? `${base.replace(/\/$/, '')}${path}` : path
}
export interface GstInvoiceRenderModel {
  gstDocumentId: string;
  templateType: "invoice" | "credit_note" | "debit_note";
  title: string;
  documentNumber: string;
  documentDate: string;
  orderNumber: string;
  orderDate: string;
  placeOfSupply: string;
  supplier: {
    name: string;
    tradeName: string;
    gstin: string;
    phone: string;
    email: string;
    lines: string[];
  };
  buyer: {
    name: string;
    gstin: string;
    phone: string;
    email: string;
    lines: string[];
  };
  shipping: {
    name: string;
    phone?: string;
    email?: string;
    lines: string[];
  };
  rows: Array<{
    lineNumber: string;
    sku: string;
    description: string;
    hsn: string;
    quantity: string;
    gross: string;
    taxable: string;
    gstRate: string;
    cgst: string;
    sgst: string;
    igst: string;
    total: string;
  }>;
  totals: {
    taxable: string;
    cgst: string;
    sgst: string;
    igst: string;
    cess: string;
    total: string;
  };
  amountInWords: string;
  declaration: string;
  footer: string;
  signature: string;
  branding: {
    headerLogoSrc: string | null;
    footerLogoSrc: string | null;
  };
}

function escapeHtml(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

function readFirstText(source: Record<string, unknown>, keys: string[], fallback = ""): string {
  for (const key of keys) {
    const text = asText(source[key]);
    if (text) return text;
  }
  return fallback;
}

function getObject(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object") {
      return value as Record<string, unknown>;
    }
  }
  return {};
}

function buildAddressLines(source: Record<string, unknown>): string[] {
  const line1 = readFirstText(source, ["addressLine1", "address1", "line1", "address_first", "address_line1"]);
  const line2 = readFirstText(source, ["addressLine2", "address2", "line2", "address_second", "address_line2"]);
  const city = readFirstText(source, ["city", "town", "district"]);
  const state = formatStateDisplay(readFirstText(source, ["stateCode", "state", "province", "provinceCode"]));
  const pincode = readFirstText(source, ["postalCode", "pincode", "zip", "zipCode"]);
  const country = readFirstText(source, ["country", "countryName"]);

  return [line1, line2, [city, state].filter(Boolean).join(", "), [pincode, country].filter(Boolean).join(", ")]
    .filter(Boolean);
}


function numberToWords(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "Zero Rupees Only";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const twoDigits = (n: number) => {
    if (n < 20) return ones[n];
    return `${tens[Math.floor(n / 10)]}${n % 10 ? ` ${ones[n % 10]}` : ""}`.trim();
  };

  const threeDigits = (n: number) => {
    const hundred = Math.floor(n / 100);
    const rem = n % 100;
    return [hundred ? `${ones[hundred]} Hundred` : "", rem ? twoDigits(rem) : ""].filter(Boolean).join(" ").trim();
  };

  const toIndianWords = (n: number) => {
    const crore = Math.floor(n / 10000000);
    const lakh = Math.floor((n % 10000000) / 100000);
    const thousand = Math.floor((n % 100000) / 1000);
    const rest = n % 1000;
    return [
      crore ? `${threeDigits(crore)} Crore` : "",
      lakh ? `${threeDigits(lakh)} Lakh` : "",
      thousand ? `${threeDigits(thousand)} Thousand` : "",
      rest ? threeDigits(rest) : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();
  };

  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);
  const parts = [`${toIndianWords(rupees)} Rupees`];
  if (paise > 0) parts.push(`${twoDigits(paise)} Paise`);
  parts.push("Only");
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function fullNameFromObject(source: Record<string, unknown>): string {
  return [asText(source.firstName || source.first_name), asText(source.lastName || source.last_name)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function resolvePartyName(candidates: unknown[], fallback = "Customer"): string {
  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) return text;
  }
  return fallback;
}

function hasUsableCustomerDetails(snapshot: Record<string, unknown>): boolean {
  const shipping = getObject(snapshot, ["shippingAddress", "shipping_address", "shipping"]);
  const billing = getObject(snapshot, ["billingAddress", "billing_address", "billing"]);
  const customer = getObject(snapshot, ["customer", "buyer"]);

  return Boolean(
    asText(snapshot.customerName) ||
      asText(snapshot.email) ||
      asText(snapshot.contactEmail) ||
      asText(snapshot.phone) ||
      asText(shipping.name) ||
      asText(shipping.address1) ||
      asText(shipping.phone) ||
      asText(billing.name) ||
      asText(billing.address1) ||
      asText(billing.phone) ||
      asText(customer.displayName) ||
      asText(customer.email) ||
      fullNameFromObject(customer),
  );
}

async function loadSourceOrderSnapshot(sourceOrderId: unknown): Promise<Record<string, unknown>> {
  const id = String(sourceOrderId || "").trim();
  if (!id) return {};

  const order = await prisma.gstOrderImport.findUnique({ where: { id }, select: { snapshot: true } });
  if (!order?.snapshot || typeof order.snapshot !== "object") return {};
  return order.snapshot as Record<string, unknown>;
}

async function loadLiveShopifyOrderSnapshot(document: Record<string, unknown>): Promise<Record<string, unknown>> {
  const orderNameOrNumber =
    asText(document.shopifyOrderName) ||
    asText(document.sourceOrderNumber) ||
    asText(document.sourceReference);

  if (!orderNameOrNumber) return {};

  try {
    const liveOrder = await getSingleShopifyOrderForGstSync({ orderNameOrNumber });
    if (liveOrder && typeof liveOrder === "object") {
      return liveOrder as Record<string, unknown>;
    }
  } catch (error) {
    console.error("[GST PDF] live Shopify order hydrate failed", {
      orderNameOrNumber,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {};
}

async function loadLinkedOrderSnapshot(document: Record<string, unknown>, snapshot: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sourceSnapshot = getObject(snapshot, ["source"]);
  if (Object.keys(sourceSnapshot).length > 0 && hasUsableCustomerDetails(sourceSnapshot)) {
    return sourceSnapshot;
  }

  const candidates: Array<{ field: "id" | "shopifyOrderId" | "shopifyOrderName"; value: string }> = [];
  const sourceOrderId = asText(document.sourceOrderId);
  const sourceOrderNumber = asText(document.sourceOrderNumber);
  const shopifyOrderId = asText(document.shopifyOrderId || snapshot.shopifyOrderId || sourceSnapshot.shopifyOrderId);
  const shopifyOrderName = asText(document.shopifyOrderName || snapshot.shopifyOrderName || sourceSnapshot.shopifyOrderName);

  if (sourceOrderId) candidates.push({ field: "id", value: sourceOrderId });
  if (shopifyOrderId) candidates.push({ field: "shopifyOrderId", value: shopifyOrderId });
  if (sourceOrderNumber) candidates.push({ field: "shopifyOrderName", value: sourceOrderNumber });
  if (shopifyOrderName && !candidates.some((candidate) => candidate.field === "shopifyOrderName" && candidate.value === shopifyOrderName)) {
    candidates.push({ field: "shopifyOrderName", value: shopifyOrderName });
  }

  for (const candidate of candidates) {
    const order = await prisma.gstOrderImport.findFirst({
      where: { [candidate.field]: candidate.value } as Record<string, string>,
      select: { snapshot: true },
      orderBy: { createdAt: "desc" },
    });
    if (order?.snapshot && typeof order.snapshot === "object") {
      const orderSnapshot = order.snapshot as Record<string, unknown>;
      if (hasUsableCustomerDetails(orderSnapshot)) {
        return orderSnapshot;
      }
    }
  }

  if (sourceOrderId) {
    const orderSnapshot = await loadSourceOrderSnapshot(sourceOrderId);
    if (hasUsableCustomerDetails(orderSnapshot)) {
      return orderSnapshot;
    }
  }

  return loadLiveShopifyOrderSnapshot(document);
}

function getInvoicePartyDetails(document: Record<string, unknown>): {
  buyerName: string;
  buyerGstin: string;
  buyerPhone: string;
  buyerEmail: string;
  billingName: string;
  shippingName: string;
  billingLines: string[];
  shippingLines: string[];
  shippingPhone: string;
  shippingEmail: string;
} {
  const snapshot = (document.jsonSnapshot || {}) as Record<string, unknown>;
  const sourceSnapshot = getObject(snapshot, ["source"]);
  const buyerSnapshot = getObject(snapshot, ["buyer", "buyerParty"]);
  const metadata = { ...getObject(snapshot, ["metadata"]), ...getObject(document, ["metadata"]) };

  const shippingSnapshot = getObject(sourceSnapshot, ["shippingAddress", "shipping_address", "shipping"]);
  const billingSnapshot = getObject(sourceSnapshot, ["billingAddress", "billing_address", "billing"]);
  const customerSnapshot = getObject(sourceSnapshot, ["customer", "buyer"]);

  const pickParty = (
    primary: Record<string, unknown>,
    fallback: Record<string, unknown>,
  ): { name: string; lines: string[]; phone: string; email: string } => {
    const name = resolvePartyName([
      primary.name,
      fullNameFromObject(primary),
      fallback.name,
      fullNameFromObject(fallback),
      sourceSnapshot.customerName,
      sourceSnapshot.customer_name,
      fullNameFromObject(customerSnapshot),
    ]);

    const linesPrimary = buildAddressLines(primary);
    const linesFallback = buildAddressLines(fallback);

    return {
      name,
      lines: linesPrimary.length ? linesPrimary : linesFallback,
      phone: resolvePartyName([primary.phone, primary.mobile, fallback.phone, fallback.mobile, customerSnapshot.phone, sourceSnapshot.phone], ""),
      email: resolvePartyName(
        [primary.email, primary.contactEmail, fallback.email, fallback.contactEmail, customerSnapshot.email, sourceSnapshot.email, sourceSnapshot.contactEmail, metadata.email],
        "",
      ),
    };
  };

  const shipParty = pickParty(shippingSnapshot, billingSnapshot);
  const billParty = pickParty(billingSnapshot, shippingSnapshot);

  const buyerName = resolvePartyName([buyerSnapshot.legalName, buyerSnapshot.name, billParty.name, shipParty.name], "Customer");
  const buyerEmail = resolvePartyName([buyerSnapshot.email, billParty.email, shipParty.email], "");
  const buyerPhone = resolvePartyName([buyerSnapshot.phone, billParty.phone, shipParty.phone], "");

  const buyerGstin = resolvePartyName(
    [buyerSnapshot.gstin, sourceSnapshot.gstin, sourceSnapshot.customerGstin, metadata.customerGstin],
    "UNREGISTERED",
  );

  const shippingName = resolvePartyName([shipParty.name, buyerName, buyerEmail], buyerName);
  const billingName = resolvePartyName([billParty.name, shippingName, buyerName, buyerEmail], buyerName);

  return {
    buyerName,
    buyerGstin: buyerGstin || "UNREGISTERED",
    buyerPhone,
    buyerEmail,
    billingName,
    shippingName,
    billingLines: billParty.lines.length ? billParty.lines : shipParty.lines,
    shippingLines: shipParty.lines.length ? shipParty.lines : billParty.lines,
    shippingPhone: shipParty.phone || buyerPhone,
    shippingEmail: shipParty.email || buyerEmail,
  };
}

export async function buildGstInvoiceRenderModel(gstDocumentId: string): Promise<GstServiceResult<GstInvoiceRenderModel>> {
  const invoiceResult = await getGstInvoiceById(gstDocumentId);
  const documentResult = invoiceResult.ok ? invoiceResult : await getGstNoteById(gstDocumentId);

  if (!documentResult.ok || !documentResult.data) {
    return { ok: false, error: documentResult.error || "GST document not found" };
  }

  const doc = documentResult.data;
  const templateType =
    String(doc.documentType || "TAX_INVOICE") === "CREDIT_NOTE"
      ? "credit_note"
      : String(doc.documentType || "TAX_INVOICE") === "DEBIT_NOTE"
        ? "debit_note"
        : "invoice";

  const title = templateType === "invoice" ? "Tax Invoice" : templateType === "credit_note" ? "Credit Note" : "Debit Note";
  const lines = Array.isArray(doc.lines) ? (doc.lines as Array<Record<string, unknown>>) : [];
  const snapshot = (doc.jsonSnapshot || {}) as Record<string, unknown>;
  const seller = (snapshot.settings || {}) as Record<string, unknown>;
  const metadata = (doc.metadata || snapshot.metadata || {}) as Record<string, unknown>;
  const classification = (snapshot.classification || {}) as Record<string, unknown>;

  const sourceSnapshot = await loadLinkedOrderSnapshot(doc as Record<string, unknown>, snapshot);
  const enrichedDocument = { ...(doc as Record<string, unknown>), jsonSnapshot: { ...snapshot, source: sourceSnapshot } };
  const partyDetails = getInvoicePartyDetails(enrichedDocument);

  const supplierName = asText(seller.legalName, "Supplier");
  const supplierTradeName = asText(seller.tradeName);
  const supplierStateCode = asText(seller.stateCode);
  const supplierAddressLines = buildAddressLines(seller);
  const fallbackSupplierAddress = "Mahadev Nagar, Plot No.3, Nandpuri, Market, Jaipur, Rajasthan, 302019";

  const placeOfSupplyCode = asText(doc.placeOfSupplyStateCode || classification.placeOfSupplyStateCode || supplierStateCode, supplierStateCode);
  const placeOfSupply = formatStateDisplay(placeOfSupplyCode, placeOfSupplyCode);

  const orderNumber = asText(doc.shopifyOrderName || doc.sourceOrderNumber);
  const orderDate = formatDate(metadata.orderCreatedAt || sourceSnapshot.createdAt || sourceSnapshot.created_at || doc.documentDate);

  const rows = lines.map((line) => {
    const description = String(line.description || "");
    const [maybeSku, maybeTitle] = description.split("•").map((part) => part.trim());
    return {
      lineNumber: String(line.lineNumber || ""),
      sku: maybeTitle ? maybeSku : "",
      description: maybeTitle || description,
      hsn: String(line.hsnOrSac || ""),
      quantity: String(line.quantity || ""),
      gross: asAmount(Number(line.quantity || 0) * Number(line.unitPrice || 0) - Number(line.discount || 0)),
      taxable: asAmount(line.taxableAmount),
      gstRate: asAmount(line.taxRate),
      cgst: asAmount(line.cgstAmount),
      sgst: asAmount(line.sgstAmount),
      igst: asAmount(line.igstAmount),
      total: asAmount(line.lineTotal),
    };
  });

  const totalValue = Number(doc.totalAmount || 0);

  return {
    ok: true,
    data: {
      gstDocumentId,
      templateType,
      title,
      documentNumber: asText(doc.documentNumber),
      documentDate: formatDate(doc.documentDate),
      orderNumber,
      orderDate,
      placeOfSupply,
      supplier: {
        name: supplierName,
        tradeName: supplierTradeName,
        gstin: asText(seller.gstin, "UNREGISTERED"),
        phone: asText(seller.phone || seller.mobile),
        email: asText(seller.email),
        lines: supplierAddressLines.length ? supplierAddressLines : [fallbackSupplierAddress],
      },
      buyer: {
        name: partyDetails.billingName,
        gstin: partyDetails.buyerGstin || "UNREGISTERED",
        phone: partyDetails.buyerPhone,
        email: partyDetails.buyerEmail,
        lines: partyDetails.billingLines,
      },
      shipping: {
        name: partyDetails.shippingName,
        phone: partyDetails.shippingPhone,
        email: partyDetails.shippingEmail,
        lines: partyDetails.shippingLines,
      },
      rows,
      totals: {
        taxable: asAmount(doc.taxableAmount),
        cgst: asAmount(doc.cgstAmount),
        sgst: asAmount(doc.sgstAmount),
        igst: asAmount(doc.igstAmount),
        cess: asAmount(doc.cessAmount),
        total: asAmount(doc.totalAmount),
      },
      amountInWords: numberToWords(totalValue),
      declaration: asText(metadata.declarationText || seller.declarationText),
      footer: asText(metadata.footerText || seller.footerText, "This is a system generated GST document."),
      signature: asText(metadata.signatureName || seller.authorizedSignatory),
    branding: {
  headerLogoSrc: publicAssetUrl("/logos/header-logo.png"),
  footerLogoSrc: publicAssetUrl("/logos/footer-logo.avif"),
},
    },
  };
}

export async function renderGstPdf(gstDocumentId: string): Promise<GstServiceResult<GstPdfRenderPayload>> {
  const modelResult = await buildGstInvoiceRenderModel(gstDocumentId);
  if (!modelResult.ok || !modelResult.data) {
    return { ok: false, error: modelResult.error || "GST document not found" };
  }

  const model = modelResult.data;
  const rows = model.rows
    .map(
      (line) => `<tr>
      <td>${escapeHtml(line.lineNumber)}</td><td>${escapeHtml(line.sku)}</td><td>${escapeHtml(line.description)}</td><td>${escapeHtml(line.hsn)}</td>
      <td>${escapeHtml(line.quantity)}</td><td>${line.taxable}</td><td>${line.gstRate}</td><td>${line.cgst}</td><td>${line.sgst}</td><td>${line.igst}</td><td>${line.total}</td>
    </tr>`,
    )
    .join("\n");

  const renderParty = (title: string, party: { name: string; gstin?: string; phone?: string; email?: string; lines: string[] }) => `
    <div class="block"><strong>${escapeHtml(title)}</strong>
      <div>${escapeHtml(party.name)}</div>
      ${party.gstin ? `<div>GSTIN: ${escapeHtml(party.gstin || "UNREGISTERED")}</div>` : ""}
      ${party.phone ? `<div>Phone: ${escapeHtml(party.phone)}</div>` : ""}
      ${party.email ? `<div>Email: ${escapeHtml(party.email)}</div>` : ""}
      ${party.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    </div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(model.documentNumber)}</title>
    <style>
      @page { size: A4 landscape; margin: 10mm; }
      body { font-family: Arial, sans-serif; color:#111; font-size:9px; margin:0; }
      .topline { display:flex; justify-content:space-between; border-bottom:1px solid #111; padding-bottom:8px; margin-bottom:10px; }
      .meta { text-align:right; }
      .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin: 10px 0; }
      .block { border:1px solid #ddd; padding:8px; min-height:90px; }
      .header-logo{ display:flex; justify-content:center; align-items:center; margin-bottom:8px; min-height:34px; font-size:16px; font-weight:700; letter-spacing:1px; text-transform:lowercase; }
      .header-logo img{ max-height:32px; max-width:220px; object-fit:contain; }
      table{ border-collapse:collapse; width:100%; table-layout:fixed; } th,td{ border:1px solid #ddd; padding:3px; vertical-align:top; font-size:8px; } th{ background:#f6f6f6; font-size:7.5px; }
      td:nth-child(2){ word-break:break-word; }
      td:nth-child(3){ word-break:break-word; }
      .totals{ width:320px; margin-left:auto; margin-top:10px; } .totals td{ border:0; padding:3px 0; }
      .footer-logo{ margin-top:8px; display:flex; justify-content:flex-end; min-height:22px; font-size:12px; font-weight:700; }
      .footer-logo img{ max-height:20px; max-width:140px; object-fit:contain; }
      .print-btn{ margin-bottom:8px; }
      @media print { .print-btn { display:none; } }
    </style></head><body>
    <button class="print-btn" onclick="window.print()">Print Invoice</button>
    <div class="header-logo">${model.branding.headerLogoSrc ? `<img src="${escapeHtml(model.branding.headerLogoSrc)}" alt="Header logo" />` : "bigonbuy"}</div>
    <div class="topline"><div><div><strong>GSTIN: ${escapeHtml(model.supplier.gstin)}</strong></div><div>${escapeHtml(model.title)}</div><div>Original for Recipient</div></div>
    <div class="meta"><div><strong>${escapeHtml(model.supplier.tradeName || model.supplier.name)}</strong></div><div>${escapeHtml(model.supplier.name)}</div></div></div>
    <div class="topline"><div>Invoice No: ${escapeHtml(model.documentNumber)}<br/>Invoice Date: ${escapeHtml(model.documentDate)}<br/>Order: ${escapeHtml(model.orderNumber)}</div><div class="meta">Place of Supply: ${escapeHtml(model.placeOfSupply)}<br/>Order Date: ${escapeHtml(model.orderDate)}</div></div>
    <div class="grid">
      ${renderParty("BILLED TO", model.buyer)}
      ${renderParty("SHIP TO", model.shipping)}
      ${renderParty("SUPPLIER", model.supplier)}
    </div>
    <table>
      <colgroup>
        <col style="width:4%"><col style="width:14%"><col style="width:28%"><col style="width:9%"><col style="width:5%">
        <col style="width:10%"><col style="width:6%"><col style="width:7%"><col style="width:7%"><col style="width:7%"><col style="width:9%">
      </colgroup>
      <thead><tr><th>#</th><th>SKU</th><th>Item</th><th>HSN</th><th>Qty</th><th>Taxable</th><th>GST%</th><th>CGST</th><th>SGST</th><th>IGST</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tr><td>Taxable</td><td>${model.totals.taxable}</td></tr><tr><td>CGST</td><td>${model.totals.cgst}</td></tr><tr><td>SGST</td><td>${model.totals.sgst}</td></tr><tr><td>IGST</td><td>${model.totals.igst}</td></tr><tr><td>CESS</td><td>${model.totals.cess}</td></tr><tr><td><strong>Total</strong></td><td><strong>${model.totals.total}</strong></td></tr></table>
    <p><strong>Amount in Words:</strong> ${escapeHtml(model.amountInWords)}</p>
    ${model.declaration ? `<p><strong>Declaration:</strong> ${escapeHtml(model.declaration)}</p>` : ""}
    <p>${escapeHtml(model.footer)}</p>
    <div class="footer-logo">${model.branding.footerLogoSrc ? `<img src="${escapeHtml(model.branding.footerLogoSrc)}" alt="Footer logo" />` : "MEGASKA"}</div>
    ${model.signature ? `<p style="text-align:right; margin-top:18px;">For ${escapeHtml(model.supplier.name)}<br/><br/>${escapeHtml(model.signature)}</p>` : ""}
  </body></html>`;

  return {
    ok: true,
    data: {
      gstDocumentId,
      documentNumber: model.documentNumber,
      html,
      metadata: {
        generatedAt: new Date().toISOString(),
        renderer: "GST_HTML_RENDERER_V4",
        templateType: model.templateType,
      },
    },
  };
}
