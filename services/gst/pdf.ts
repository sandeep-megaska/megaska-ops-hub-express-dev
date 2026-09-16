import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../db/prisma";
import { getGstInvoiceById } from "./invoice";
import { getGstNoteById } from "./notes";
import { getSingleShopifyOrderForGstSync } from "./shopify-runtime-admin";
import { getGstStatePrimaryNameByCode, resolveGstStateCode } from "./state-codes";
import { buildGstInvoiceHtml } from "./invoice-html";
import type { GstServiceResult } from "./types";
import { gstPerfLog, gstPerfNow } from "./perf";
import {
  isGstInvoicePaperSize,
  resolveGstInvoiceTemplateConfig,
  type GstInvoicePaperSize,
  type GstInvoiceTemplateConfig,
} from "./template";

export interface GstPdfRenderPayload {
  gstDocumentId: string;
  documentNumber: string;
  html: string;
  metadata: {
    generatedAt: string;
    renderer: "GST_HTML_RENDERER_V4";
    templateType: "invoice" | "credit_note" | "debit_note";
    paperSize: GstInvoicePaperSize;
  };
}

export { buildGstInvoiceHtml, GST_INVOICE_PAPER_GEOMETRY } from "./invoice-html";
export type { GstInvoicePaperGeometry } from "./invoice-html";

export interface GstPdfRenderOptions {
  /** Overrides the template's configured paper size for this render only. */
  paperSize?: GstInvoicePaperSize | string | null;
}

export function resolveGstInvoicePaperSize(
  override: GstPdfRenderOptions["paperSize"],
  configured: GstInvoicePaperSize | undefined,
): GstInvoicePaperSize {
  if (isGstInvoicePaperSize(override)) return override;
  if (isGstInvoicePaperSize(configured)) return configured;
  return "auto";
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
    variant: string;
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
  templateConfig: GstInvoiceTemplateConfig;
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

function publicAssetUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  return base ? `${base.replace(/\/$/, "")}${path}` : path;
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
  const hydrateStartedAtMs = gstPerfNow();
  const sourceSnapshot = getObject(snapshot, ["source"]);
  if (Object.keys(sourceSnapshot).length > 0 && hasUsableCustomerDetails(sourceSnapshot)) {
    gstPerfLog("gst.pdf.linkedOrderHydrate", hydrateStartedAtMs, { source: "snapshot", found: true });
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
        gstPerfLog("gst.pdf.linkedOrderHydrate", hydrateStartedAtMs, { source: "gstOrderImport", found: true, field: candidate.field });
        return orderSnapshot;
      }
    }
  }

  if (sourceOrderId) {
    const orderSnapshot = await loadSourceOrderSnapshot(sourceOrderId);
    if (hasUsableCustomerDetails(orderSnapshot)) {
      gstPerfLog("gst.pdf.linkedOrderHydrate", hydrateStartedAtMs, { source: "sourceOrder", found: true });
      return orderSnapshot;
    }
  }

  const liveSnapshot = await loadLiveShopifyOrderSnapshot(document);
  gstPerfLog("gst.pdf.linkedOrderHydrate", hydrateStartedAtMs, { source: "liveShopify", found: Object.keys(liveSnapshot).length > 0 });
  return liveSnapshot;
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

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function fileToDataUrl(filePath: string): string | null {
  try {
    const absolute = path.join(process.cwd(), "public", filePath.replace(/^\//, ""));
    if (!existsSync(absolute)) return null;
    const bytes = readFileSync(absolute);
    return `data:${inferMimeType(filePath)};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

type LogoResolutionResult = {
  src: string | null;
  configured: boolean;
  resolvedConfiguredAsset: boolean;
  usedFallback: boolean;
  fallbackResolved: boolean;
  sourceType: "data" | "blob" | "local" | "remote" | "none";
};

// A configured (usually remote) logo was previously re-fetched on EVERY render with
// cache:"no-store" — the dominant PDF-render latency and the cause of the "much delay"
// merchants saw across both invoice popups. Cache the resolved data URI in-process,
// keyed by the source URL, so a warm instance fetches each logo at most once per TTL.
// A changed logo is picked up within the window. Only successful remote resolutions are
// cached (never fallbacks), so a transient failure is retried on the next render.
const LOGO_DATA_URL_CACHE_TTL_MS = 30 * 60 * 1000;
const logoDataUrlCache = new Map<string, { dataUrl: string; expiresAt: number }>();

async function resolveInvoiceLogoForPdf(customUrl: unknown, fallbackPath: string): Promise<LogoResolutionResult> {
  const custom = typeof customUrl === "string" ? customUrl.trim() : "";
  const configured = Boolean(custom);
  if (custom.startsWith("data:image/")) {
    return { src: custom, configured, resolvedConfiguredAsset: true, usedFallback: false, fallbackResolved: false, sourceType: "data" };
  }
  if (custom.startsWith("blob:")) {
    return { src: null, configured, resolvedConfiguredAsset: false, usedFallback: false, fallbackResolved: false, sourceType: "blob" };
  }
  if (custom.startsWith("/")) {
    const localData = fileToDataUrl(custom);
    if (localData) {
      return { src: localData, configured, resolvedConfiguredAsset: true, usedFallback: false, fallbackResolved: false, sourceType: "local" };
    }
  }
  if (custom) {
    const remoteSourceType = custom.startsWith("/") ? "local" : "remote";
    const cached = logoDataUrlCache.get(custom);
    if (cached && cached.expiresAt > Date.now()) {
      return { src: cached.dataUrl, configured, resolvedConfiguredAsset: true, usedFallback: false, fallbackResolved: false, sourceType: remoteSourceType };
    }
    // Bounded: a configured logo URL that is slow/unreachable (or a self-referential
    // app URL that deadlocks in serverless) must not hang the whole PDF render. The abort
    // must cover the BODY read too - a stalled body (headers arrive, bytes never do) is the
    // exact failure mode of a self-referential app URL, and reading arrayBuffer() outside the
    // timeout would hang forever. Clear the timer only after the body is fully read. On timeout
    // (or any error) we fall through to the local fallback logo below.
    const logoController = new AbortController();
    const logoTimer = setTimeout(() => logoController.abort(), 4000);
    try {
      const response = await fetch(publicAssetUrl(custom), { cache: "no-store", signal: logoController.signal });
      if (response.ok) {
        const mime = response.headers.get("content-type") || "image/png";
        const buffer = Buffer.from(await response.arrayBuffer());
        const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
        logoDataUrlCache.set(custom, { dataUrl, expiresAt: Date.now() + LOGO_DATA_URL_CACHE_TTL_MS });
        return { src: dataUrl, configured, resolvedConfiguredAsset: true, usedFallback: false, fallbackResolved: false, sourceType: remoteSourceType };
      }
    } catch {} finally {
      clearTimeout(logoTimer);
    }
  }

  const fallback = fileToDataUrl(fallbackPath);
  return { src: fallback, configured, resolvedConfiguredAsset: false, usedFallback: true, fallbackResolved: Boolean(fallback), sourceType: configured ? (custom.startsWith("/") ? "local" : "remote") : "none" };
}
export async function buildGstInvoiceRenderModel(gstDocumentId: string): Promise<GstServiceResult<GstInvoiceRenderModel>> {
  const renderModelStartedAtMs = gstPerfNow();
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
  const logoTemplateStartedAtMs = gstPerfNow();
  const template = await prisma.gstInvoiceTemplate.findFirst({
    where: { gstSettingsId: String((doc as Record<string, unknown>).gstSettingsId || ""), isDefault: true },
    select: { themeConfig: true },
  });
  const themeConfig = ((template?.themeConfig || {}) as Record<string, unknown>);
  const templateConfig = resolveGstInvoiceTemplateConfig(themeConfig);
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
      variant: "",
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

  const [headerLogo, footerLogo] = await Promise.all([
    resolveInvoiceLogoForPdf(themeConfig.headerLogoUrl, "/logos/header-logo.png"),
    resolveInvoiceLogoForPdf(themeConfig.footerLogoUrl, "/logos/footer-logo.png"),
  ]);
  const headerLogoSrc = templateConfig.showHeaderLogo ? headerLogo.src : null;
  const footerLogoSrc = templateConfig.showFooterLogo ? footerLogo.src : null;
  gstPerfLog("gst.pdf.logoTemplateResolution", logoTemplateStartedAtMs, {
    gstDocumentId,
    templateFound: Boolean(template),
    headerLogo: Boolean(headerLogoSrc),
    footerLogo: Boolean(footerLogoSrc),
    headerLogoConfigExists: headerLogo.configured,
    footerLogoConfigExists: footerLogo.configured,
    headerLogoAssetResolved: headerLogo.resolvedConfiguredAsset,
    footerLogoAssetResolved: footerLogo.resolvedConfiguredAsset,
    headerLogoUsedFallback: headerLogo.usedFallback,
    footerLogoUsedFallback: footerLogo.usedFallback,
    headerLogoFallbackResolved: headerLogo.fallbackResolved,
    footerLogoFallbackResolved: footerLogo.fallbackResolved,
    headerLogoSourceType: headerLogo.sourceType,
    footerLogoSourceType: footerLogo.sourceType,
  });

  gstPerfLog("gst.pdf.renderModel", renderModelStartedAtMs, { gstDocumentId, lineCount: lines.length, templateType });
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
        headerLogoSrc,
        footerLogoSrc: templateConfig.showFooterLogo ? footerLogoSrc : null,
      },
      templateConfig: {
        ...templateConfig,
        showHeaderLogo: templateConfig.showHeaderLogo,
        showFooterLogo: templateConfig.showFooterLogo,
      },
    },
  };
}

export async function renderGstPdf(
  gstDocumentId: string,
  options: GstPdfRenderOptions = {},
): Promise<GstServiceResult<GstPdfRenderPayload>> {
  const htmlStartedAtMs = gstPerfNow();
  const modelResult = await buildGstInvoiceRenderModel(gstDocumentId);
  if (!modelResult.ok || !modelResult.data) {
    return { ok: false, error: modelResult.error || "GST document not found" };
  }

  const model = modelResult.data;
  const paperSize = resolveGstInvoicePaperSize(options.paperSize, model.templateConfig.paperSize);
  const html = buildGstInvoiceHtml(model, paperSize);

  gstPerfLog("gst.pdf.htmlRender", htmlStartedAtMs, { gstDocumentId, rowCount: model.rows.length, paperSize });
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
        paperSize,
      },
    },
  };
}
