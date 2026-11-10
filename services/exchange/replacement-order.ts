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

// Orders that must not get a GST invoice number: free parcels, ₹0 replacements.
export function isNoInvoiceOrderTags(tags: unknown): boolean {
  const list = (Array.isArray(tags) ? tags.map(String) : String(tags || "").split(",")).map((tag) => tag.trim().toLowerCase());
  if (list.includes("loopd2c collab")) return true;
  return list.includes(EXCHANGE_ORDER_TAG.toLowerCase()) && list.includes(NO_CHARGE_TAG.toLowerCase());
}
