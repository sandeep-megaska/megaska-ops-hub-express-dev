import type { MinorMoney, ShopifyPricingDiscountAllocation, ShopifyPricingReadModel, ShopifyPricingSourceCapabilities, ShopifyPricingSourceType } from "./types";

export const AJAX_CART_CAPABILITIES: ShopifyPricingSourceCapabilities = {
  originalSubtotal: true,
  discountedSubtotal: true,
  finalTotal: true,
  perLineOriginalTotal: true,
  perLineDiscountedTotal: true,
  lineDiscountAllocations: true,
  cartDiscountAllocations: false,
  discountCodeApplicability: false,
  loopDeskAppDiscountAttribution: false,
};

export const STOREFRONT_CART_CAPABILITIES: ShopifyPricingSourceCapabilities = {
  originalSubtotal: true,
  discountedSubtotal: true,
  finalTotal: true,
  perLineOriginalTotal: true,
  perLineDiscountedTotal: true,
  lineDiscountAllocations: true,
  cartDiscountAllocations: true,
  discountCodeApplicability: true,
  loopDeskAppDiscountAttribution: false,
};

function currencyOf(raw: any, fallback = "INR") {
  return String(raw?.currency || raw?.currencyCode || raw?.cost?.totalAmount?.currencyCode || fallback || "INR").trim().toUpperCase();
}

function minor(amount: unknown, currency: string | null, available = true): MinorMoney {
  if (amount === null || amount === undefined || amount === "") return { amount: null, currencyCode: currency, available: false };
  if (typeof amount === "number" && Number.isFinite(amount)) return { amount, currencyCode: currency, available };
  const parsed = Number(amount);
  return Number.isFinite(parsed) ? { amount: Math.round(parsed * 100), currencyCode: currency, available } : { amount: null, currencyCode: currency, available: false };
}

function unavailable(currency: string | null): MinorMoney {
  return { amount: null, currencyCode: currency, available: false };
}

function titleOf(allocation: any) {
  return allocation?.title || allocation?.discount_application?.title || allocation?.discountApplication?.title || allocation?.discountApplication?.code || null;
}

function codeOf(allocation: any) {
  return allocation?.code || allocation?.discount_application?.code || allocation?.discountApplication?.code || null;
}

function allocationAmount(allocation: any, currency: string): MinorMoney {
  if (allocation?.amountSet?.shopMoney?.amount !== undefined) return minor(allocation.amountSet.shopMoney.amount, allocation.amountSet.shopMoney.currencyCode || currency);
  if (allocation?.discountedAmount?.amount !== undefined) return minor(allocation.discountedAmount.amount, allocation.discountedAmount.currencyCode || currency);
  return minor(allocation?.amount, currency);
}

function normalizeAllocation(allocation: any, currency: string, targetType: ShopifyPricingDiscountAllocation["targetType"], lineKey: string | null): ShopifyPricingDiscountAllocation {
  return {
    targetType,
    lineKey,
    title: titleOf(allocation),
    code: codeOf(allocation),
    appKey: allocation?.discount_application?.app_key || allocation?.discountApplication?.appKey || null,
    amount: allocationAmount(allocation, currency),
    sourceRawType: allocation?.type || allocation?.discount_application?.type || allocation?.discountApplication?.__typename || null,
  };
}

export function normalizeAjaxCartPricing(rawCart: any, options?: { fetchedAt?: string }): ShopifyPricingReadModel {
  const currency = currencyOf(rawCart);
  const lines = Array.isArray(rawCart?.items) ? rawCart.items.map((item: any) => {
    const key = item?.key ? String(item.key) : null;
    const allocations = Array.isArray(item?.discounts) ? item.discounts.map((discount: any) => normalizeAllocation(discount, currency, "line", key)) : null;
    return {
      id: item?.id ?? null,
      key,
      variantId: item?.variant_id ?? null,
      productId: item?.product_id ?? null,
      quantity: Number(item?.quantity || 0),
      title: item?.title || item?.product_title || null,
      originalTotal: minor(item?.original_line_price, currency),
      discountedTotal: minor(item?.discounted_price !== undefined && item?.quantity !== undefined ? Number(item.discounted_price) * Number(item.quantity) : item?.final_line_price, currency),
      finalLineTotal: minor(item?.final_line_price, currency),
      discountAllocations: allocations,
    };
  }) : [];
  const allAllocations = lines.flatMap((line: { discountAllocations: ShopifyPricingDiscountAllocation[] | null }) => line.discountAllocations || []);
  const discountCodes = Array.isArray(rawCart?.cart_level_discount_applications)
    ? rawCart.cart_level_discount_applications.map((app: any) => ({ code: String(app?.code || app?.title || ""), applicable: null })).filter((entry: any) => entry.code)
    : null;
  const model: ShopifyPricingReadModel = {
    cartIdentity: { token: rawCart?.token || null, cartId: null, sourceIdentity: rawCart?.token || null },
    currency,
    lines,
    originalSubtotal: minor(rawCart?.original_total_price ?? rawCart?.items_subtotal_price, currency),
    discountedSubtotal: minor(rawCart?.items_subtotal_price, currency),
    totalDiscount: minor(rawCart?.total_discount, currency),
    finalTotal: minor(rawCart?.total_price, currency),
    shipping: unavailable(currency),
    tax: unavailable(currency),
    discountCodes,
    discountAllocations: allAllocations.length ? allAllocations : null,
    sourceType: "ajax-cart" as ShopifyPricingSourceType,
    fetchedAt: options?.fetchedAt || new Date().toISOString(),
    authoritative: true,
    rawCapabilities: AJAX_CART_CAPABILITIES,
  };
  return enforceCurrency(model, currency);
}

export function enforceCurrency(model: ShopifyPricingReadModel, currency: string) {
  const fix = (money: MinorMoney | null) => money && money.currencyCode && money.currencyCode !== currency ? { ...money, currencyCode: currency } : money;
  return {
    ...model,
    originalSubtotal: fix(model.originalSubtotal)!,
    discountedSubtotal: fix(model.discountedSubtotal)!,
    totalDiscount: fix(model.totalDiscount)!,
    finalTotal: fix(model.finalTotal)!,
    shipping: fix(model.shipping),
    tax: fix(model.tax),
    lines: model.lines.map((line) => ({
      ...line,
      originalTotal: fix(line.originalTotal)!,
      discountedTotal: fix(line.discountedTotal)!,
      finalLineTotal: fix(line.finalLineTotal)!,
      discountAllocations: line.discountAllocations?.map((allocation) => ({ ...allocation, amount: fix(allocation.amount)! })) || null,
    })),
    discountAllocations: model.discountAllocations?.map((allocation) => ({ ...allocation, amount: fix(allocation.amount)! })) || null,
  };
}

export function logPricingDiagnostics(model: ShopifyPricingReadModel, debug?: boolean) {
  if (!debug && process.env.LOOPDESK_DEBUG_PRICING !== "true") return;
  console.info("[SHOPIFY PRICING READ MODEL]", {
    sourceSelected: model.sourceType,
    cartIdentity: model.cartIdentity.sourceIdentity,
    lineCount: model.lines.length,
    originalSubtotal: model.originalSubtotal.amount,
    totalDiscount: model.totalDiscount.amount,
    finalTotal: model.finalTotal.amount,
    discountAllocationCount: model.discountAllocations?.length || 0,
    appliedCodeCount: model.discountCodes?.length || 0,
  });
}
