export type PickerVariantPriceSource = "selected_variant" | "product_variant" | "first_variant" | "unavailable";

export type PickerVariantPriceExtraction = {
  variantPrice: string | null;
  variantCompareAtPrice: string | null;
  priceSource: PickerVariantPriceSource;
  compareAtPriceSource: PickerVariantPriceSource;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, value);
}

function normalizeMoney(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (isRecord(value)) return normalizeMoney(value.amount ?? value.value ?? value.price);
  return null;
}

function variantsFrom(resource: unknown): unknown[] {
  const variants = isRecord(resource) ? resource.variants : undefined;
  if (Array.isArray(variants)) return variants;
  const nodes = readPath(resource, ["variants", "nodes"]);
  if (Array.isArray(nodes)) return nodes;
  return [];
}

function sameId(left: unknown, right: unknown) {
  if (!left || !right) return false;
  const a = String(left);
  const b = String(right);
  return a === b || a.split("/").pop() === b.split("/").pop();
}

function priceFromVariant(variant: unknown) {
  return normalizeMoney(readPath(variant, ["priceV2", "amount"]) ?? readPath(variant, ["price", "amount"]) ?? readPath(variant, ["price"]));
}

function compareAtFromVariant(variant: unknown) {
  return normalizeMoney(readPath(variant, ["compareAtPriceV2", "amount"]) ?? readPath(variant, ["compareAtPrice", "amount"]) ?? readPath(variant, ["compareAtPrice"]));
}

export function extractPickerVariantPrices(resource: unknown, selectedVariantId?: unknown): PickerVariantPriceExtraction {
  try {
    const selectedVariant = isRecord(resource) ? resource.selectedVariant : undefined;
    const productVariant = isRecord(resource) ? resource.variant : undefined;
    const variants = variantsFrom(resource);
    const matchedVariant = selectedVariantId ? variants.find((variant) => sameId(isRecord(variant) ? variant.id : undefined, selectedVariantId)) : undefined;
    const singleVariant = variants.length === 1 ? variants[0] : undefined;
    const firstVariant = variants[0];
    const candidates: Array<{ source: PickerVariantPriceSource; value: unknown }> = [
      { source: "selected_variant", value: selectedVariant },
      { source: "product_variant", value: productVariant },
      { source: "product_variant", value: resource },
      { source: "product_variant", value: matchedVariant },
      { source: "first_variant", value: singleVariant ?? firstVariant },
    ];

    let variantPrice: string | null = null;
    let variantCompareAtPrice: string | null = null;
    let priceSource: PickerVariantPriceSource = "unavailable";
    let compareAtPriceSource: PickerVariantPriceSource = "unavailable";

    for (const candidate of candidates) {
      if (!candidate.value) continue;
      const price = priceFromVariant(candidate.value);
      if (!variantPrice && price) {
        variantPrice = price;
        priceSource = candidate.source;
      }
      const compareAt = compareAtFromVariant(candidate.value);
      if (!variantCompareAtPrice && compareAt) {
        variantCompareAtPrice = compareAt;
        compareAtPriceSource = candidate.source;
      }
      if (variantPrice && variantCompareAtPrice) break;
    }

    return { variantPrice, variantCompareAtPrice, priceSource, compareAtPriceSource };
  } catch {
    return { variantPrice: null, variantCompareAtPrice: null, priceSource: "unavailable", compareAtPriceSource: "unavailable" };
  }
}
