// Free parcels the store sends at its own cost: influencer, collab, PR, gifts,
// samples to vendors and manufacturers, photoshoots.
//
// Each parcel becomes a ₹0 Shopify order (100% discount, tagged COLLAB_ORDER_TAG):
// Shopify takes the stock off and the order sits in Shopify's own reports, while
// this module keeps what accounts and audit need (retail value, product cost from
// the variant's cost price, shipping cost) and tracks the parcel. Delhivery booking
// goes through the Shipments flow (bookOrderShipments): a ₹0 order has nothing
// outstanding, so it is always booked Prepaid, declared at its retail value.
import type { MegaskaOrderStatus } from "../../generated/prisma/index.js";

export const COLLAB_ORDER_TAG = "LoopD2C Collab";
export const COLLAB_PURPOSES = ["INFLUENCER", "COLLAB", "PR", "VENDOR_SAMPLE", "INTERNAL", "GIFT", "OTHER"] as const;
export type CollabPurpose = (typeof COLLAB_PURPOSES)[number];
export const PURPOSE_LABEL: Record<CollabPurpose, string> = { INFLUENCER: "Influencer", COLLAB: "Brand collab", PR: "PR / media", VENDOR_SAMPLE: "Sample to vendor / manufacturer", INTERNAL: "Photoshoot / internal", GIFT: "Gift", OTHER: "Other" };
// Parcels where the recipient is expected to post content.
export const CONTENT_PURPOSES: readonly CollabPurpose[] = ["INFLUENCER", "COLLAB", "PR"];
export const expectsContent = (purpose: string) => (CONTENT_PURPOSES as readonly string[]).includes(purpose);
export const DELIVERABLE_STATUSES = ["PENDING", "POSTED", "NOT_POSTED", "NOT_NEEDED"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const MAX_COLLAB_ITEMS = 20;
const TERMINAL_TRACKING: MegaskaOrderStatus[] = ["DELIVERED", "RTO_DELIVERED", "CANCELLED"];

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
] as const;

export type CollabAddress = { company?: string; address1: string; address2: string; city: string; state: string; pin: string };
export type CollabItem = { variantId: string; title: string; sku: string; quantity: number; unitPricePaise: number; unitCostPaise: number | null };
export type CollabInput = {
  purpose: CollabPurpose;
  recipientName: string;
  recipientPhone: string; // +91XXXXXXXXXX
  recipientEmail: string | null;
  recipientHandle: string | null;
  platform: string | null;
  campaign: string | null;
  notes: string | null;
  address: CollabAddress;
  items: { variantId: string; quantity: number }[];
  weightGrams: number;
  notifyRecipient: boolean;
};

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export function normalizeIndianPhone(value: unknown): string | null {
  let digits = text(value, 30).replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null;
}

// Validates the admin form. Prices and cost always come from Shopify, never from here.
export function normalizeCollabInput(body: unknown): { ok: true; data: CollabInput } | { ok: false; error: string } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const purpose = text(input.purpose).toUpperCase() as CollabPurpose;
  if (!COLLAB_PURPOSES.includes(purpose)) return { ok: false, error: "Choose what this parcel is for." };
  const recipientName = text(input.recipientName, 80);
  if (recipientName.length < 2) return { ok: false, error: "Enter the recipient's name." };
  const recipientPhone = normalizeIndianPhone(input.recipientPhone);
  if (!recipientPhone) return { ok: false, error: "Enter a 10-digit Indian mobile number for the courier." };
  const email = text(input.recipientEmail, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "The email address doesn't look right." };
  const raw = (input.address && typeof input.address === "object" ? input.address : {}) as Record<string, unknown>;
  const address: CollabAddress = { company: text(raw.company, 80) || undefined, address1: text(raw.address1, 200), address2: text(raw.address2, 200), city: text(raw.city, 80), state: text(raw.state, 80), pin: text(raw.pin, 10).replace(/\D/g, "") };
  if (address.address1.length < 5) return { ok: false, error: "Enter the street address." };
  if (!address.city) return { ok: false, error: "Enter the city." };
  if (!(INDIAN_STATES as readonly string[]).includes(address.state)) return { ok: false, error: "Choose the state." };
  if (!/^[1-9]\d{5}$/.test(address.pin)) return { ok: false, error: "Pincode must be 6 digits." };
  const merged = new Map<string, number>();
  for (const item of Array.isArray(input.items) ? input.items : []) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const variantId = text(row.variantId, 100);
    const quantity = Math.floor(Number(row.quantity));
    if (!variantId.startsWith("gid://shopify/ProductVariant/") || !Number.isFinite(quantity) || quantity < 1) continue;
    merged.set(variantId, Math.min(50, (merged.get(variantId) || 0) + quantity));
  }
  if (!merged.size) return { ok: false, error: "Add at least one product." };
  if (merged.size > MAX_COLLAB_ITEMS) return { ok: false, error: `Add at most ${MAX_COLLAB_ITEMS} different products per parcel.` };
  const weight = Math.round(Number(input.weightGrams));
  return {
    ok: true,
    data: {
      purpose,
      recipientName,
      recipientPhone,
      recipientEmail: email || null,
      recipientHandle: text(input.recipientHandle, 80) || null,
      platform: text(input.platform, 40) || null,
      campaign: text(input.campaign, 80) || null,
      notes: text(input.notes, 500) || null,
      address,
      items: [...merged].map(([variantId, quantity]) => ({ variantId, quantity })),
      weightGrams: Number.isFinite(weight) && weight >= 50 && weight <= 30000 ? weight : 500,
      notifyRecipient: input.notifyRecipient === true && Boolean(email),
    },
  };
}

export const VARIANT_FIELDS = `id title displayName sku price inventoryQuantity inventoryPolicy product { title status } inventoryItem { tracked unitCost { amount } }`;
export const VARIANTS_BY_ID_QUERY = `query CollabVariants($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { ${VARIANT_FIELDS} } } }`;
export const VARIANT_SEARCH_QUERY = `query CollabVariantSearch($query: String!) { productVariants(first: 20, query: $query) { nodes { ${VARIANT_FIELDS} } } }`;

export type ShopifyVariantNode = {
  id?: string;
  title?: string | null;
  displayName?: string | null;
  sku?: string | null;
  price?: string | null;
  inventoryQuantity?: number | null;
  inventoryPolicy?: string | null;
  product?: { title?: string | null; status?: string | null } | null;
  inventoryItem?: { tracked?: boolean | null; unitCost?: { amount?: string | null } | null } | null;
};

export function amountToPaise(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function variantView(node: ShopifyVariantNode) {
  return {
    variantId: String(node.id || ""),
    title: text(node.displayName, 200) || [node.product?.title, node.title].map((part) => text(part)).filter(Boolean).join(" - "),
    sku: text(node.sku, 80),
    unitPricePaise: amountToPaise(node.price) ?? 0,
    unitCostPaise: amountToPaise(node.inventoryItem?.unitCost?.amount),
    available: node.inventoryItem?.tracked === false ? null : Number(node.inventoryQuantity ?? 0),
    productStatus: text(node.product?.status) || null,
  };
}

// Prices the parcel from Shopify's variant data; anything that would stop or
// surprise the merchant is returned as an error or a warning.
export function priceCollabItems(requested: { variantId: string; quantity: number }[], nodes: ShopifyVariantNode[]) {
  const byId = new Map(nodes.filter((node) => node?.id).map((node) => [String(node.id), node]));
  const items: CollabItem[] = [];
  const warnings: string[] = [];
  for (const line of requested) {
    const node = byId.get(line.variantId);
    if (!node) return { ok: false as const, error: "A product in this parcel was not found in Shopify. Remove it and add it again." };
    const view = variantView(node);
    if (view.available !== null && view.available < line.quantity) {
      if (String(node.inventoryPolicy || "").toUpperCase() !== "CONTINUE") return { ok: false as const, error: `${view.title}: only ${Math.max(0, view.available)} in stock.` };
      warnings.push(`${view.title}: only ${Math.max(0, view.available)} in stock; Shopify will go below zero.`);
    }
    if (view.unitCostPaise === null) warnings.push(`${view.title}: no cost price in Shopify, so product cost is left out for it.`);
    items.push({ variantId: view.variantId, title: view.title, sku: view.sku, quantity: line.quantity, unitPricePaise: view.unitPricePaise, unitCostPaise: view.unitCostPaise });
  }
  return { ok: true as const, items, warnings, ...collabTotals(items) };
}

export function collabTotals(items: CollabItem[]) {
  return {
    retailValuePaise: items.reduce((sum, item) => sum + item.unitPricePaise * item.quantity, 0),
    productCostPaise: items.reduce((sum, item) => sum + (item.unitCostPaise ?? 0) * item.quantity, 0),
  };
}

function splitName(name: string) {
  const parts = name.split(" ").filter(Boolean);
  return parts.length > 1 ? { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] } : { firstName: name, lastName: "." };
}

// The ₹0 Shopify order: real variants (stock goes down), one 100% order discount
// titled so reports show why it's free, no tax, tagged and annotated for audit.
export function buildCollabDraftOrderInput(collabId: string, input: CollabInput) {
  const { firstName, lastName } = splitName(input.recipientName);
  const shippingAddress = { firstName, lastName, company: input.address.company || undefined, address1: input.address.address1, address2: input.address.address2 || undefined, city: input.address.city, province: input.address.state, country: "India", zip: input.address.pin, phone: input.recipientPhone };
  const purposeLabel = PURPOSE_LABEL[input.purpose];
  return {
    lineItems: input.items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
    email: input.recipientEmail || undefined,
    shippingAddress,
    billingAddress: shippingAddress,
    appliedDiscount: { title: `${purposeLabel} - paid by store`, description: "Free parcel: product and shipping paid by the store", value: 100, valueType: "PERCENTAGE" },
    taxExempt: true,
    tags: [COLLAB_ORDER_TAG, `Free parcel: ${purposeLabel}`, ...(input.campaign ? [`Campaign: ${input.campaign.slice(0, 40)}`] : [])],
    note: [`${purposeLabel}: free parcel, paid by the store (LoopD2C ${collabId}).`, input.address.company ? `Company: ${input.address.company}` : "", input.recipientHandle ? `Handle: ${input.recipientHandle}${input.platform ? ` (${input.platform})` : ""}` : "", input.campaign ? `Campaign: ${input.campaign}` : "", input.notes || ""].filter(Boolean).join("\n"),
    customAttributes: [
      { key: "loopd2c_collab_id", value: collabId },
      { key: "loopd2c_collab_purpose", value: input.purpose },
      ...(input.campaign ? [{ key: "loopd2c_collab_campaign", value: input.campaign }] : []),
    ],
  };
}

export function isCollabOrderTags(tags: unknown): boolean {
  const list = Array.isArray(tags) ? tags.map(String) : String(tags || "").split(",");
  return list.some((tag) => tag.trim().toLowerCase() === COLLAB_ORDER_TAG.toLowerCase());
}

export function isTrackingDone(status: MegaskaOrderStatus | null | undefined) {
  return Boolean(status && TERMINAL_TRACKING.includes(status));
}

export const TRACKING_LABEL: Partial<Record<MegaskaOrderStatus, string>> = {
  ORDER_CONFIRMED: "Booked", READY_FOR_PICKUP: "Awaiting pickup", PICKED_UP: "Picked up", IN_TRANSIT: "In transit",
  OUT_FOR_DELIVERY: "Out for delivery", DELIVERED: "Delivered", DELIVERY_FAILED: "Delivery failed", RTO_INITIATED: "Returning to you",
  RTO_DELIVERED: "Returned to you", CANCELLED: "Cancelled",
};

export function trackingUpdate(snapshot: { normalizedStatus: MegaskaOrderStatus; rawStatus?: string | null; statusUpdatedAt?: Date | null; trackingUrl?: string | null }, current: { trackingUrl: string | null; deliveredAt: Date | null }, now = new Date()) {
  const at = snapshot.statusUpdatedAt || now;
  return {
    trackingStatus: snapshot.normalizedStatus,
    trackingRawStatus: snapshot.rawStatus ? String(snapshot.rawStatus).slice(0, 200) : null,
    trackingUpdatedAt: now,
    trackingUrl: snapshot.trackingUrl || current.trackingUrl,
    deliveredAt: snapshot.normalizedStatus === "DELIVERED" ? current.deliveredAt || at : current.deliveredAt,
  };
}

export type CollabRow = {
  id: string; createdAt: Date; purpose: string; recipientName: string; recipientPhone: string; recipientHandle: string | null; platform: string | null;
  campaign: string | null; address: unknown; items: unknown; retailValuePaise: number; productCostPaise: number; shippingCostPaise: number | null;
  status: string; shopifyOrderName: string | null; awb: string | null; trackingStatus: MegaskaOrderStatus | null; deliveredAt: Date | null;
  deliverableStatus: string; contentUrl: string | null; postedAt: Date | null; notes: string | null;
};

export function summarizeCollabs(rows: Pick<CollabRow, "retailValuePaise" | "productCostPaise" | "shippingCostPaise" | "deliverableStatus" | "trackingStatus" | "status">[]) {
  const sent = rows.filter((row) => row.status !== "FAILED" && row.status !== "CREATING");
  const expectsPost = sent.filter((row) => row.deliverableStatus !== "NOT_NEEDED");
  return {
    parcels: sent.length,
    retailValuePaise: sent.reduce((sum, row) => sum + row.retailValuePaise, 0),
    productCostPaise: sent.reduce((sum, row) => sum + row.productCostPaise, 0),
    shippingCostPaise: sent.reduce((sum, row) => sum + (row.shippingCostPaise ?? 0), 0),
    delivered: sent.filter((row) => row.trackingStatus === "DELIVERED").length,
    posted: expectsPost.filter((row) => row.deliverableStatus === "POSTED").length,
    expectingPost: expectsPost.length,
  };
}

function csvCell(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  // Leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const rupees = (paise: number | null) => (paise === null ? "" : (paise / 100).toFixed(2));

// One line per item, so quantities and costs add up per SKU in a spreadsheet.
export function collabCsv(rows: CollabRow[]) {
  const header = ["Date", "Shopify order", "Purpose", "Campaign / reference", "Company", "Recipient", "Phone", "Handle", "Platform", "City", "State", "SKU", "Product", "Qty", "Unit retail (INR)", "Unit cost (INR)", "Line retail (INR)", "Line cost (INR)", "Parcel shipping cost (INR)", "AWB", "Delivery", "Delivered on", "Content", "Content link", "Status"];
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    const address = (row.address && typeof row.address === "object" ? row.address : {}) as Partial<CollabAddress>;
    const items = (Array.isArray(row.items) ? row.items : []) as CollabItem[];
    items.forEach((item, index) => {
      lines.push([
        row.createdAt.toISOString().slice(0, 10), row.shopifyOrderName, PURPOSE_LABEL[row.purpose as CollabPurpose] || row.purpose, row.campaign, address.company, row.recipientName, row.recipientPhone,
        row.recipientHandle, row.platform, address.city, address.state, item.sku, item.title, item.quantity, rupees(item.unitPricePaise), rupees(item.unitCostPaise),
        rupees(item.unitPricePaise * item.quantity), item.unitCostPaise === null ? "" : rupees(item.unitCostPaise * item.quantity),
        index === 0 ? rupees(row.shippingCostPaise) : "", row.awb, row.trackingStatus ? TRACKING_LABEL[row.trackingStatus] || row.trackingStatus : "",
        row.deliveredAt ? row.deliveredAt.toISOString().slice(0, 10) : "", row.deliverableStatus, row.contentUrl, row.status,
      ].map(csvCell).join(","));
    });
  }
  return lines.join("\n") + "\n";
}

// A calendar month in India time (YYYY-MM; defaults to this month).
export function monthRange(month: string | null) {
  const match = /^(\d{4})-(\d{2})$/.exec(month || "");
  const now = new Date(Date.now() + 330 * 60000);
  const year = match ? Number(match[1]) : now.getUTCFullYear();
  const index = match ? Number(match[2]) - 1 : now.getUTCMonth();
  // India time: the month starts at 00:00 IST.
  const from = new Date(Date.UTC(year, index, 1) - 330 * 60000);
  const to = new Date(Date.UTC(year, index + 1, 1) - 330 * 60000);
  return { from, to, month: `${year}-${String(index + 1).padStart(2, "0")}` };
}
