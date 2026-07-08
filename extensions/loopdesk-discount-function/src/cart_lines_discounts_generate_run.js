const CONFIG_NAMESPACE = "loopdesk";
const CONFIG_KEY = "discount_function_config";
const SUPPORTED_REWARD_ENFORCEMENT_TYPES = new Set([
  "fixed_price",
  "percentage",
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

function isValidRewardValue(rule) {
  if (rule.rewardEnforcementType === "fixed_price") {
    return Number.isFinite(Number(rule.fixedPriceAmount));
  }

  if (rule.rewardEnforcementType === "percentage") {
    const percentage = Number(rule.percentageValue);
    return Number.isFinite(percentage) && percentage > 0 && percentage <= 100;
  }

  return false;
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
    if (typeof rule.rewardVariantGid !== "string" || !rule.rewardVariantGid.trim()) return false;
    if (!SUPPORTED_REWARD_ENFORCEMENT_TYPES.has(String(rule.rewardEnforcementType))) return false;
    if (!isValidRewardValue(rule)) return false;
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

function cartSubtotal(cartLines) {
  return cartLines.reduce((sum, line) => sum + (Number.isFinite(line.subtotalAmount) ? line.subtotalAmount : 0), 0);
}

function cartQuantity(cartLines) {
  return cartLines.reduce((sum, line) => sum + (Number.isFinite(line.quantity) ? line.quantity : 0), 0);
}

function triggerMatches(rule, cartLines) {
  const triggerValue = String(rule.triggerValue ?? "").trim();

  if (rule.triggerType === "always") return true;
  if (!triggerValue) return false;

  if (rule.triggerType === "cart_contains_product") return cartLines.some((line) => line.productGid === triggerValue);
  if (rule.triggerType === "cart_contains_collection") return cartLines.some((line) => line.collectionGids.includes(triggerValue));
  if (rule.triggerType === "cart_contains_variant") return cartLines.some((line) => line.variantGid === triggerValue);
  if (rule.triggerType === "cart_contains_product_type") return cartLines.some((line) => line.productType === triggerValue);
  if (rule.triggerType === "cart_contains_tag") return cartLines.some((line) => line.tags.includes(triggerValue));
  if (rule.triggerType === "cart_subtotal_gte") return cartSubtotal(cartLines) >= Number(rule.triggerValue);
  if (rule.triggerType === "cart_quantity_gte") return cartQuantity(cartLines) >= Number(rule.triggerValue);

  return false;
}

function cappedQuantity(line, rule) {
  const cap = Number(rule.quantity || 0);
  return Math.max(0, Math.min(line.quantity, Number.isFinite(cap) && cap > 0 ? cap : line.quantity));
}

function createDiscountOperation(rule, line) {
  const quantity = cappedQuantity(line, rule);
  if (!line.id || quantity <= 0) return null;

  const target = { cartLine: { id: line.id, quantity } };

  if (rule.rewardEnforcementType === "percentage") {
    return {
      productDiscountsAdd: {
        candidates: [{
          message: "LoopDesk reward",
          targets: [target],
          value: { percentage: { value: Number(rule.percentageValue).toString() } },
        }],
        selectionStrategy: "FIRST",
      },
    };
  }

  if (rule.rewardEnforcementType === "fixed_price") {
    const unitPrice = line.quantity > 0 ? line.subtotalAmount / line.quantity : 0;
    const discountAmount = Math.max(0, unitPrice - Number(rule.fixedPriceAmount));
    if (!Number.isFinite(discountAmount) || discountAmount <= 0) return null;

    return {
      productDiscountsAdd: {
        candidates: [{
          message: "LoopDesk reward",
          targets: [target],
          value: { fixedAmount: { amount: discountAmount.toFixed(2), appliesToEachItem: true } },
        }],
        selectionStrategy: "FIRST",
      },
    };
  }

  return null;
}

/**
 * Universal LoopDesk promotion discount function foundation.
 *
 * @param {unknown} input
 * @returns {{operations: unknown[]}}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const config = parseConfig(input);
  if (!config) return NO_DISCOUNTS;

  const cartLines = parseCartLines(input);
  const evaluation = prepareEvaluationPipeline(cartLines, config.rules);

  for (const rule of evaluation.rules) {
    if (!triggerMatches(rule, cartLines)) continue;
    const rewardLine = cartLines.find((line) => line.variantGid === rule.rewardVariantGid);
    if (!rewardLine) continue;

    evaluation.matchedRules.push(rule);
    const operation = createDiscountOperation(rule, rewardLine);
    if (operation) evaluation.discountOperations.push(operation);
  }

  return { operations: evaluation.discountOperations };
}

export const loopDeskDiscountFunctionMetafieldContract = {
  namespace: CONFIG_NAMESPACE,
  key: CONFIG_KEY,
};
