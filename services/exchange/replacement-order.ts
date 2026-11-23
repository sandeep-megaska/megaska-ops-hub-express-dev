// The Shopify order for an exchange replacement, so stock goes down, the replacement
// is on record next to the original order, and any extra the customer paid is a
// normal invoiced sale. Pure helpers; the Shopify calls are in
// replacement-order-operations.ts.
//
// Order total = what the customer paid extra for this replacement:
// - same product, new size, or a cheaper / same-price style: ₹0 (100% discount),
//   tagged "No charge" so GST auto-invoicing skips it (the original sale was invoiced);
// - dearer style: the difference collected by payment link (discount = the rest),
//   so the GST module invoices exactly that amount.

export const EXCHANGE_ORDER_TAG = "LoopD2C Exchange";
export const NO_CHARGE_TAG = "No charge";

const SIZE_ALIASES: Record<string, string> = {
  xsmall: "XS", extrasmall: "XS", xs: "XS",
  small: "S", s: "S",
  medium: "M", m: "M",
  large: "L", l: "L",
  xlarge: "XL", extralarge: "XL", xl: "XL",
  xxlarge: "XXL", "2xl": "XXL", xxl: "XXL", doublexl: "XXL",
  xxxlarge: "XXXL", "3xl": "XXXL", xxxl: "XXXL",
};

export function normalizeSize(value: string | null | undefined) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return SIZE_ALIASES[key] ?? key.toUpperCase();
}

type Option = { name?: string | null; value?: string | null };
export type SizeVariant = { id: string; sku?: string | null; price?: string | null; inventoryQuantity?: number | null; selectedOptions?: Option[] | null };

const isSizeOption = (name: string | null | undefined) => /size/i.test(String(name || ""));

// Same product, same colour/other options, requested size.
export function pickSizeVariant(original: Option[], variants: SizeVariant[], requestedSize: string): SizeVariant | null {
  const wanted = normalizeSize(requestedSize);
  if (!wanted) return null;
  const others = original.filter((option) => !isSizeOption(option.name));
  return variants.find((variant) => {
    const options = variant.selectedOptions ?? [];
    const size = options.find((option) => isSizeOption(option.name));
    if (!size || normalizeSize(size.value) !== wanted) return false;
    return others.every((other) => options.some((option) => option.name === other.name && option.value === other.value));
  }) ?? null;
}

// What the replacement order should charge (paise).
export function replacementChargePaise(input: { styleDifferencePaise?: number | null; styleSettlement?: string | null; styleSettledAt?: Date | string | null }) {
  const difference = input.styleDifferencePaise ?? 0;
  return difference > 0 && input.styleSettlement === "COLLECT" && input.styleSettledAt ? difference : 0;
}

export type ReplacementLine = { variantId: string; quantity: number; unitPricePaise: number };
type Address = { name: string; phone: string; address1: string; address2: string; city: string; state: string; pin: string; email?: string | null };

const rupees = (paise: number) => (Math.max(0, Math.round(paise)) / 100).toFixed(2);

export function buildReplacementDraftOrder(input: {
  requestId: string;
  orderNumber: string;
  lines: ReplacementLine[];
  chargePaise: number;
  address: Address;
  customerGid?: string | null;
  email?: string | null;
}) {
  const subtotal = input.lines.reduce((sum, line) => sum + line.unitPricePaise * line.quantity, 0);
  const charge = Math.min(Math.max(0, input.chargePaise), subtotal);
  const parts = input.address.name.trim().split(/\s+/);
  const shippingAddress = {
    firstName: parts.length > 1 ? parts.slice(0, -1).join(" ") : parts[0] || "Customer",
    lastName: parts.length > 1 ? parts[parts.length - 1] : ".",
    address1: input.address.address1,
    address2: input.address.address2 || undefined,
    city: input.address.city,
    province: input.address.state,
    country: "India",
    zip: input.address.pin,
    phone: input.address.phone,
  };
  const order = String(input.orderNumber).replace(/^#/, "");
  return {
    lineItems: input.lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    ...(input.customerGid ? { customerId: input.customerGid } : {}),
    email: input.email || input.address.email || undefined,
    shippingAddress,
    billingAddress: shippingAddress,
    appliedDiscount: charge > 0
      ? { title: `Exchange for #${order}`, description: "Already paid on the original order", value: Number(rupees(subtotal - charge)), valueType: "FIXED_AMOUNT" }
      : { title: `Exchange for #${order}`, description: "Replacement for an exchanged item", value: 100, valueType: "PERCENTAGE" },
    // A ₹0 replacement carries no tax; a charged difference is taxed like any sale.
    taxExempt: charge === 0,
    tags: [EXCHANGE_ORDER_TAG, `Exchange for #${order}`, ...(charge === 0 ? [NO_CHARGE_TAG] : [])],
    note: `Replacement for exchange on order #${order} (LoopD2C ${input.requestId}).${charge > 0 ? ` Customer paid ₹${rupees(charge)} difference for a different style.` : ""}`,
    customAttributes: [
      { key: "loopd2c_exchange_request_id", value: input.requestId },
      { key: "loopd2c_original_order", value: order },
    ],
  };
}

// What the warehouse packs, as it goes on the courier label (Delhivery products_desc).
// The replacement's own SKU comes first so the packer can't mistake it for the
// original: a size exchange used to print the original variant and SKU
// ("… / Navy Royal / XL / Lycra / Size L / MBPS07-NavyRoyal-XL") and the XL was sent.
export type PackedLine = { title: string; variantTitle?: string | null; sku?: string | null; quantity: number };
type ExchangeItemForPacking = { productTitle?: string | null; variantTitle?: string | null; sku?: string | null; currentSize?: string | null; requestedSize?: string | null; quantity: number; replacementTitle?: string | null; replacementSku?: string | null };

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

// "Navy Royal / XL / Lycra" with XL -> L gives "Navy Royal / L / Lycra"; null if the size isn't in it.
export function swapSizeInVariantTitle(variantTitle: string | null | undefined, currentSize: string | null | undefined, requestedSize: string | null | undefined) {
  const parts = text(variantTitle).split(" / ").filter(Boolean);
  const from = normalizeSize(currentSize);
  const index = from ? parts.findIndex((part) => normalizeSize(part) === from) : -1;
  if (index < 0 || !text(requestedSize)) return null;
  parts[index] = text(requestedSize);
  return parts.join(" / ");
}

function packedLineText(line: PackedLine) {
  return [line.sku ? `SKU ${text(line.sku)}` : null, text(line.title), text(line.variantTitle) || null, `x${line.quantity}`].filter(Boolean).join(" · ");
}

export function replacementPackingDescription(input: { packed?: PackedLine[] | null; items: ExchangeItemForPacking[] }) {
  // Best: the replacement Shopify order's own lines (exactly what was ordered).
  const packed = (input.packed ?? []).filter((line) => text(line.title));
  if (packed.length) return packed.map(packedLineText).join("; ").slice(0, 500);
  // Fallback: the replacement worked out from the exchange, never the original's SKU.
  return input.items.map((item) => {
    if (item.replacementTitle) return packedLineText({ title: item.replacementTitle, sku: item.replacementSku, quantity: item.quantity });
    const variant = swapSizeInVariantTitle(item.variantTitle, item.currentSize, item.requestedSize) ?? (item.requestedSize ? `Size ${text(item.requestedSize)}` : null);
    return packedLineText({ title: text(item.productTitle), variantTitle: variant, quantity: item.quantity });
  }).filter(Boolean).join("; ").slice(0, 500) || "Exchange replacement item";
}

// Orders that must not get a GST invoice number: free parcels, ₹0 replacements.
export function isNoInvoiceOrderTags(tags: unknown): boolean {
  const list = (Array.isArray(tags) ? tags.map(String) : String(tags || "").split(",")).map((tag) => tag.trim().toLowerCase());
  if (list.includes("loopd2c collab")) return true;
  return list.includes(EXCHANGE_ORDER_TAG.toLowerCase()) && list.includes(NO_CHARGE_TAG.toLowerCase());
}
