export type ShopifyPricingSourceType = "ajax-cart" | "storefront-cart";

export type { PricingDiagnostics, ShopifyTaxLine, TaxSummary } from "./tax-summary";

export type MinorMoney = {
  amount: number | null;
  currencyCode: string | null;
  available: boolean;
};

export type ShopifyPricingDiscountAllocation = {
  targetType: "line" | "cart" | "shipping" | "unknown";
  lineKey: string | null;
  title: string | null;
  code: string | null;
  appKey: string | null;
  amount: MinorMoney;
  sourceRawType: string | null;
};

export type ShopifyPricingDiscountCode = {
  code: string;
  applicable: boolean | null;
};

export type ShopifyPricingLine = {
  id: string | number | null;
  key: string | null;
  variantId: number | string | null;
  productId: number | string | null;
  quantity: number;
  title: string | null;
  originalTotal: MinorMoney;
  discountedTotal: MinorMoney;
  finalLineTotal: MinorMoney;
  discountAllocations: ShopifyPricingDiscountAllocation[] | null;
};

export type ShopifyPricingReadModel = {
  cartIdentity: {
    token: string | null;
    cartId: string | null;
    sourceIdentity: string | null;
  };
  currency: string;
  lines: ShopifyPricingLine[];
  originalSubtotal: MinorMoney;
  discountedSubtotal: MinorMoney;
  totalDiscount: MinorMoney;
  finalTotal: MinorMoney;
  shipping: MinorMoney | null;
  tax: MinorMoney | null;
  discountCodes: ShopifyPricingDiscountCode[] | null;
  discountAllocations: ShopifyPricingDiscountAllocation[] | null;
  sourceType: ShopifyPricingSourceType;
  fetchedAt: string;
  authoritative: true;
  rawCapabilities: ShopifyPricingSourceCapabilities;
};

export type ShopifyPricingSourceCapabilities = {
  originalSubtotal: boolean;
  discountedSubtotal: boolean;
  finalTotal: boolean;
  perLineOriginalTotal: boolean;
  perLineDiscountedTotal: boolean;
  lineDiscountAllocations: boolean;
  cartDiscountAllocations: boolean;
  discountCodeApplicability: boolean;
  loopDeskAppDiscountAttribution: boolean;
};

export type ShopifyPricingSourceReadParams = {
  cartToken?: string | null;
  cartId?: string | null;
  shopDomain?: string | null;
  ajaxCart?: unknown;
  fetchImpl?: typeof fetch;
  debug?: boolean;
};

export interface ShopifyPricingSource {
  readonly sourceType: ShopifyPricingSourceType;
  readPricing(params?: ShopifyPricingSourceReadParams): Promise<ShopifyPricingReadModel>;
}
