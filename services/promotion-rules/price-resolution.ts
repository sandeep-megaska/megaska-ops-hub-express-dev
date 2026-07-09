export type PromotionComparePriceSource = "shopify_variant_price" | "legacy_compare_price" | "unavailable";

type ComparePriceRuleShape = {
  reward?: { product?: { variantPrice?: unknown }; variantPrice?: unknown; [key: string]: unknown };
  rewardProductVariantPrice?: unknown;
  display?: { comparePriceDisplay?: unknown };
};

function cleanDisplayText(value: unknown) {
  return (typeof value === "string" ? value.replace(/[<>]/g, "").replace(/javascript:/gi, "").trim().slice(0, 80) : "") || "";
}

export function resolvePromotionComparePrice(rule: ComparePriceRuleShape) {
  const variantPrice = cleanDisplayText(rule.reward?.product?.variantPrice);
  const rewardVariantPrice = cleanDisplayText(rule.reward?.variantPrice);
  const rewardProductVariantPrice = cleanDisplayText(rule.rewardProductVariantPrice);
  const legacyComparePrice = cleanDisplayText(rule.display?.comparePriceDisplay);
  if (variantPrice) return { value: variantPrice, source: "shopify_variant_price" as PromotionComparePriceSource };
  if (rewardVariantPrice) return { value: rewardVariantPrice, source: "shopify_variant_price" as PromotionComparePriceSource };
  if (rewardProductVariantPrice) return { value: rewardProductVariantPrice, source: "shopify_variant_price" as PromotionComparePriceSource };
  if (legacyComparePrice) return { value: legacyComparePrice, source: "legacy_compare_price" as PromotionComparePriceSource };
  return { value: "", source: "unavailable" as PromotionComparePriceSource };
}
