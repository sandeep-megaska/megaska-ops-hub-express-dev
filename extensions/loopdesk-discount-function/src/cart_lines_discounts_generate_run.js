const CONFIG_NAMESPACE = "loopdesk";
const CONFIG_KEY = "discount_function_config";
const SUPPORTED_REWARD_ENFORCEMENT_TYPES = new Set([
  "fixed_price",
]);
const SUPPORTED_TRIGGER_TYPES = new Set([
  "always",
  "cart_contains_product",
  "cart_contains_collection",
  "cart_contains_variant",
  "cart_contains_product_type",
  "cart_contains_tag",
  "cart_subtotal_gte",
  "cart_quantity_gte",
]);

const NO_DISCOUNTS = { operations: [] };

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseConfig(input) {
  const rawValue = input?.discountNode?.metafield?.value;
  if (typeof rawValue !== "string" || !rawValue.trim()) return null;

  let parsed;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.enabled !== true || !Array.isArray(parsed.rules)) return null;

  const rules = parsed.rules.filter((rule) => {
    if (!isRecord(rule) || rule.enabled !== true) return false;
    if (typeof rule.id !== "string" || !rule.id.trim()) return false;
    if (!SUPPORTED_REWARD_ENFORCEMENT_TYPES.has(String(rule.rewardEnforcementType))) return false;
    if (!Number.isFinite(Number(rule.fixedPriceAmount))) return false;
    return SUPPORTED_TRIGGER_TYPES.has(String(rule.triggerType));
  });

  if (!rules.length) return null;

  return {
    schemaVersion: 1,
    enabled: true,
    rules,
  };
}

function parseCartLines(input) {
  const lines = Array.isArray(input?.cart?.lines) ? input.cart.lines : [];

  return lines.map((line) => {
    const merchandise = line?.merchandise || {};
    const product = merchandise?.product || {};

    return {
      id: String(line?.id || ""),
      quantity: Number(line?.quantity || 0),
      subtotalAmount: Number(line?.cost?.subtotalAmount?.amount || 0),
      currencyCode: String(line?.cost?.subtotalAmount?.currencyCode || ""),
      variantGid: String(merchandise?.id || ""),
      productGid: String(product?.id || ""),
      productType: String(product?.productType || ""),
      tags: Array.isArray(product?.tags) ? product.tags.map(String) : [],
      collectionGids: Array.isArray(product?.inCollections)
        ? product.inCollections
            .filter((membership) => membership?.isMember)
            .map((membership) => String(membership?.collectionId || ""))
            .filter(Boolean)
        : [],
    };
  });
}

function prepareEvaluationPipeline(cartLines, rules) {
  return {
    cartLines,
    rules: [...rules].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0)),
    matchedRules: [],
    discountOperations: [],
  };
}

/**
 * Universal LoopDesk promotion discount function foundation.
 *
 * This phase intentionally returns no discount operations. Future phases will
 * use the parsed cart lines and compiled rules to enforce promotion rewards.
 *
 * @param {unknown} input
 * @returns {{operations: unknown[]}}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = parseConfig(input);
  if (!config) return NO_DISCOUNTS;

  const cartLines = parseCartLines(input);
  const evaluation = prepareEvaluationPipeline(cartLines, config.rules);

  return { operations: evaluation.discountOperations };
}

export const loopDeskDiscountFunctionMetafieldContract = {
  namespace: CONFIG_NAMESPACE,
  key: CONFIG_KEY,
};
