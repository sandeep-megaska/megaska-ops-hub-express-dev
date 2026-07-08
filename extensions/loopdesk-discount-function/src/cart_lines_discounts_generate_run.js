const CONFIG_NAMESPACE = "loopdesk";
const CONFIG_KEY = "discount_function_config";
const SUPPORTED_REWARD_ENFORCEMENT_TYPES = new Set(["fixed_price"]);
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

function positiveNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
}

function fixedPriceForRule(rule) {
  return positiveNumber(rule.fixedPriceAmount ?? rule.fixedPrice ?? rule.fixedPriceValue ?? rule.rewardFixedPrice);
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

  const rules = parsed.rules
    .filter((rule) => {
      if (!isRecord(rule) || rule.enabled !== true) return false;
      if (typeof rule.id !== "string" || !rule.id.trim()) return false;
      if (!SUPPORTED_REWARD_ENFORCEMENT_TYPES.has(String(rule.rewardEnforcementType))) return false;
      if (!SUPPORTED_TRIGGER_TYPES.has(String(rule.triggerType))) return false;
      if (typeof rule.rewardVariantGid !== "string" || !rule.rewardVariantGid.trim()) return false;
      return fixedPriceForRule(rule) !== null;
    })
    .map((rule) => ({ ...rule, fixedPriceAmount: fixedPriceForRule(rule) }));

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
    const quantity = Math.max(0, Math.floor(Number(line?.quantity || 0)));
    const subtotalAmount = Math.max(0, Number(line?.cost?.subtotalAmount?.amount || 0));

    return {
      id: String(line?.id || ""),
      quantity,
      subtotalAmount,
      unitPrice: quantity > 0 ? subtotalAmount / quantity : 0,
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

function triggerMatches(rule, cartLines) {
  const triggerValue = String(rule.triggerValue ?? "").trim();

  if (rule.triggerType === "always") return true;
  if (rule.triggerType === "cart_subtotal_gte") return cartLines.reduce((total, line) => total + line.subtotalAmount, 0) >= Number(rule.triggerValue || 0);
  if (rule.triggerType === "cart_quantity_gte") return cartLines.reduce((total, line) => total + line.quantity, 0) >= Number(rule.triggerValue || 0);
  if (!triggerValue) return false;

  return cartLines.some((line) => {
    if (rule.triggerType === "cart_contains_product") return line.productGid === triggerValue;
    if (rule.triggerType === "cart_contains_collection") return line.collectionGids.includes(triggerValue);
    if (rule.triggerType === "cart_contains_variant") return line.variantGid === triggerValue;
    if (rule.triggerType === "cart_contains_product_type") return line.productType === triggerValue;
    if (rule.triggerType === "cart_contains_tag") return line.tags.includes(triggerValue);
    return false;
  });
}

function discountCandidatesForRule(rule, cartLines) {
  if (!triggerMatches(rule, cartLines)) return [];

  const maxQuantity = Math.max(0, Math.floor(Number(rule.quantity || 0))) || 1;
  const fixedPriceAmount = Number(rule.fixedPriceAmount);

  return cartLines
    .filter((line) => line.id && line.quantity > 0 && line.variantGid === rule.rewardVariantGid)
    .map((line) => {
      const discountAmount = line.unitPrice - fixedPriceAmount;
      if (!Number.isFinite(discountAmount) || discountAmount <= 0) return null;

      return {
        targets: [
          {
            cartLine: {
              id: line.id,
              quantity: Math.min(line.quantity, maxQuantity),
            },
          },
        ],
        value: {
          fixedAmount: {
            amount: discountAmount.toFixed(2),
            appliesToEachItem: true,
          },
        },
        message: "LoopDesk fixed price reward",
      };
    })
    .filter(Boolean);
}

function prepareEvaluationPipeline(cartLines, rules) {
  const sortedRules = [...rules].sort((a, b) => Number(a.priority || 0) - Number(b.priority || 0));
  const discountCandidates = sortedRules.flatMap((rule) => discountCandidatesForRule(rule, cartLines));

  return {
    cartLines,
    rules: sortedRules,
    matchedRules: [],
    discountOperations: discountCandidates.length
      ? [
          {
            productDiscountsAdd: {
              candidates: discountCandidates,
              selectionStrategy: "ALL",
            },
          },
        ]
      : [],
  };
}

/**
 * Enforces LoopDesk fixed_price promotion rewards in Shopify checkout.
 *
 * Only compiled fixed_price rules from the LoopDesk discount function config
 * metafield are considered. Shopify cart line prices remain authoritative.
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
