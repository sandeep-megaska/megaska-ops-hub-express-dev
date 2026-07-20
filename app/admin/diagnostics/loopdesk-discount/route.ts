import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { getAdminShopDomainFromSearchParams, type AdminShopSearchParams } from "../../../../services/shopify/admin-shop-context";
import { shopifyAdminGraphql } from "../../../../services/shopify/admin";
import { LOOPDESK_FUNCTION_HANDLE, LOOPDESK_FUNCTION_METAFIELD_KEY, LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, LOOPDESK_FUNCTION_METAFIELD_TYPE } from "../../../../services/promotions/runtime/function-contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPECTED_AUTOMATIC_DISCOUNT_ID = "gid://shopify/DiscountAutomaticNode/1630105567530";
const EXPECTED_RULE_ID = "94bb2bb5-8f8e-4fbd-b807-8e64fe60b76c";
const EXPECTED_COMPILATION_VERSION = 1;
const EXPECTED_TRIGGER_PRODUCT_GID = "gid://shopify/Product/10092273140010";
const EXPECTED_OFFER_PRODUCT_GID = "gid://shopify/Product/9958145229098";
const EXPECTED_REWARD = { type: "PERCENTAGE_OFF", value: "49", maximumQuantity: 1 };

type DiscountNodeDiagnostic = {
  id: string;
  metafield?: { namespace: string; key: string; type: string; value: string } | null;
  discount?: {
    discountId?: string | null;
    title?: string | null;
    status?: string | null;
    discountClasses?: string[] | null;
    combinesWith?: { orderDiscounts?: boolean | null; productDiscounts?: boolean | null; shippingDiscounts?: boolean | null } | null;
    appDiscountType?: { appKey?: string | null; functionId?: string | null } | null;
  } | null;
};

type ShopifyFunctionNode = { id?: string | null; handle?: string | null; title?: string | null; apiType?: string | null; appKey?: string | null };
type RuntimeSyncStateRow = { shopifyAutomaticDiscountId: string | null; lastDeployedConfigurationVersion: number | null; lastDeployedConfigurationHash: string | null; lastDeployedRuleCount: number | null; lastSuccessfulSyncAt: Date | null; synchronizationState: string | null; lastAttemptedAt: Date | null; lastErrorCode: string | null; lastErrorMessage: string | null; updatedAt: Date };
type DiagnosticRule = { ruleId?: unknown; compilationVersion?: unknown; trigger?: { sourceGroups?: Array<{ productGids?: unknown }> }; offer?: { productGid?: unknown }; reward?: { scope?: unknown; method?: unknown; configuration?: { value?: unknown; quantityCap?: unknown }; type?: unknown; value?: unknown; maximumQuantity?: unknown } };
type DiagnosticConfig = { functionContractVersion?: unknown; configurationVersion?: unknown; configurationHash?: unknown; rules?: DiagnosticRule[] };

function diagnosticSecret() { return String(process.env.ADMIN_OPS_KEY || process.env.INTERNAL_DIAGNOSTIC_SECRET || "").trim(); }
function providedSecret(req: NextRequest) {
  const url = new URL(req.url);
  return String(req.headers.get("x-admin-ops-key") || req.headers.get("x-internal-diagnostic-secret") || url.searchParams.get("ops_key") || url.searchParams.get("diagnostic_secret") || "").trim();
}
function isAuthorized(req: NextRequest) { if (process.env.NODE_ENV !== "production") return true; const expected = diagnosticSecret(); return Boolean(expected) && providedSecret(req) === expected; }
function collectSearchParams(req: NextRequest) {
  const url = new URL(req.url);
  const params: AdminShopSearchParams = {};
  url.searchParams.forEach((value, key) => { const existing = params[key]; if (Array.isArray(existing)) existing.push(value); else if (existing !== undefined) params[key] = [existing, value]; else params[key] = value; });
  return params;
}
function safeParseJson(raw: string | null | undefined) { if (!raw) return { ok: false as const, value: null, error: "Metafield value is empty." }; try { return { ok: true as const, value: JSON.parse(raw), error: null }; } catch (error) { return { ok: false as const, value: null, error: error instanceof Error ? error.message : "Invalid JSON" }; } }
function normalizeRewardValue(value: unknown) { return typeof value === "number" ? String(value) : String(value ?? ""); }
function mismatch(name: string, expected: unknown, actual: unknown) { return Object.is(expected, actual) ? null : { field: name, expected, actual }; }
function arrayIncludesMismatch(name: string, expected: string, actual: unknown) { return Array.isArray(actual) && actual.includes(expected) ? null : { field: name, expected, actual }; }

async function readDiscount(shopDomain: string | null, discountId: string) {
  const data = await shopifyAdminGraphql<{ discountNode: DiscountNodeDiagnostic | null }>(`
    query LoopDeskAutomaticDiscountDiagnostic($id: ID!) {
      discountNode(id: $id) {
        id
        metafield(namespace: "${LOOPDESK_FUNCTION_METAFIELD_NAMESPACE}", key: "${LOOPDESK_FUNCTION_METAFIELD_KEY}") { namespace key type value }
        discount { ... on DiscountAutomaticApp { discountId title status discountClasses combinesWith { orderDiscounts productDiscounts shippingDiscounts } appDiscountType { appKey functionId } } }
      }
    }
  `, { id: discountId }, { shopDomain });
  return data.discountNode;
}

async function readRuntimeSyncState(shopDomain: string | null) {
  try {
    const rows = shopDomain
      ? await prisma.$queryRaw<RuntimeSyncStateRow[]>`
          SELECT s."shopifyAutomaticDiscountId", s."lastDeployedConfigurationVersion", s."lastDeployedConfigurationHash", s."lastDeployedRuleCount", s."lastSuccessfulSyncAt", s."synchronizationState", s."lastAttemptedAt", s."lastErrorCode", s."lastErrorMessage", s."updatedAt"
          FROM "PromotionRuntimeSyncState" s
          JOIN "Shop" shop ON shop."id" = s."shopId"
          WHERE shop."shopDomain" = ${shopDomain} OR shop."myshopifyDomain" = ${shopDomain}
          ORDER BY s."updatedAt" DESC
          LIMIT 1
        `
      : await prisma.$queryRaw<RuntimeSyncStateRow[]>`
          SELECT "shopifyAutomaticDiscountId", "lastDeployedConfigurationVersion", "lastDeployedConfigurationHash", "lastDeployedRuleCount", "lastSuccessfulSyncAt", "synchronizationState", "lastAttemptedAt", "lastErrorCode", "lastErrorMessage", "updatedAt"
          FROM "PromotionRuntimeSyncState"
          ORDER BY "updatedAt" DESC
          LIMIT 1
        `;
    return rows[0] ?? null;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function readFunctionByHandle(shopDomain: string | null, expectedFunctionId: string | null | undefined) {
  try {
    const data = await shopifyAdminGraphql<{ shopifyFunctions?: { nodes?: ShopifyFunctionNode[] } }>(`
      query LoopDeskAppFunctionDiagnostic {
        shopifyFunctions(first: 100) { nodes { id handle title apiType appKey } }
      }
    `, {}, { shopDomain });
    const nodes = data.shopifyFunctions?.nodes ?? [];
    return { available: true, expectedHandleFunction: nodes.find((node) => node.handle === LOOPDESK_FUNCTION_HANDLE) ?? null, linkedFunction: nodes.find((node) => node.id === expectedFunctionId) ?? null, nodes };
  } catch (error) {
    return { available: false, error: error instanceof Error ? error.message : String(error), expectedHandleFunction: null, linkedFunction: null, nodes: [] as ShopifyFunctionNode[] };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: "Diagnostics are not authorized." }, { status: 403 });
  const url = new URL(req.url);
  const params = collectSearchParams(req);
  const shopDomain = getAdminShopDomainFromSearchParams(params) || null;
  const discountId = url.searchParams.get("discountId") || EXPECTED_AUTOMATIC_DISCOUNT_ID;

  const [discountNode, syncState] = await Promise.all([
    readDiscount(shopDomain, discountId),
    readRuntimeSyncState(shopDomain),
  ]);

  const discount = discountNode?.discount ?? null;
  const parsed = safeParseJson(discountNode?.metafield?.value);
  const config = parsed.ok ? parsed.value as DiagnosticConfig : null;
  const rules = Array.isArray(config?.rules) ? config.rules : [];
  const configuredRewardScopes = Array.from(new Set(rules.map((rule) => String(rule.reward?.scope ?? (rule.reward?.type ? "product" : "unknown"))))).sort();
  const availableDiscountClasses = discount?.discountClasses ?? [];
  const orderRuleCount = rules.filter((rule) => rule.reward?.scope === "order").length;
  const currentRule = rules.find((rule) => rule?.ruleId === EXPECTED_RULE_ID) ?? rules[0] ?? null;
  const triggerProductGids = Array.isArray(currentRule?.trigger?.sourceGroups) ? Array.from(new Set(currentRule.trigger.sourceGroups.flatMap((group) => Array.isArray(group?.productGids) ? group.productGids.map(String) : []))) : [];
  const functionDiagnostic = await readFunctionByHandle(shopDomain, discount?.appDiscountType?.functionId);
  const expectedHandleFunctionId = functionDiagnostic.expectedHandleFunction?.id ?? null;

  const mismatches = [
    mismatch("automaticDiscountNodeId", EXPECTED_AUTOMATIC_DISCOUNT_ID, discountNode?.id ?? null),
    mismatch("functionHandle", LOOPDESK_FUNCTION_HANDLE, functionDiagnostic.expectedHandleFunction?.handle ?? null),
    expectedHandleFunctionId && discount?.appDiscountType?.functionId ? mismatch("automaticDiscountFunctionId", expectedHandleFunctionId, discount.appDiscountType.functionId) : null,
    mismatch("metafieldNamespace", LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, discountNode?.metafield?.namespace ?? null),
    mismatch("metafieldKey", LOOPDESK_FUNCTION_METAFIELD_KEY, discountNode?.metafield?.key ?? null),
    mismatch("metafieldType", LOOPDESK_FUNCTION_METAFIELD_TYPE, discountNode?.metafield?.type ?? null),
    mismatch("ruleId", EXPECTED_RULE_ID, currentRule?.ruleId ?? null),
    mismatch("compilationVersion", EXPECTED_COMPILATION_VERSION, currentRule?.compilationVersion ?? null),
    arrayIncludesMismatch("triggerProductGids", EXPECTED_TRIGGER_PRODUCT_GID, triggerProductGids),
    mismatch("offerProductGid", EXPECTED_OFFER_PRODUCT_GID, currentRule?.offer?.productGid ?? null),
    mismatch("rewardScope", "product", currentRule?.reward?.scope ?? (currentRule?.reward?.type ? "product" : null)),
    mismatch("rewardMethod", "percentage", currentRule?.reward?.method ?? (currentRule?.reward?.type === EXPECTED_REWARD.type ? "percentage" : null)),
    mismatch("rewardValue", EXPECTED_REWARD.value, normalizeRewardValue(currentRule?.reward?.configuration?.value ?? currentRule?.reward?.value)),
    mismatch("rewardMaximumQuantity", EXPECTED_REWARD.maximumQuantity, currentRule?.reward?.configuration?.quantityCap ?? currentRule?.reward?.maximumQuantity ?? null),
  ].filter(Boolean);

  return NextResponse.json({
    ok: true,
    shopDomain,
    expected: { automaticDiscountNodeId: EXPECTED_AUTOMATIC_DISCOUNT_ID, functionHandle: LOOPDESK_FUNCTION_HANDLE, metafield: { namespace: LOOPDESK_FUNCTION_METAFIELD_NAMESPACE, key: LOOPDESK_FUNCTION_METAFIELD_KEY, type: LOOPDESK_FUNCTION_METAFIELD_TYPE }, ruleId: EXPECTED_RULE_ID, compilationVersion: EXPECTED_COMPILATION_VERSION, triggerProductGid: EXPECTED_TRIGGER_PRODUCT_GID, offerProductGid: EXPECTED_OFFER_PRODUCT_GID, reward: EXPECTED_REWARD },
    automaticDiscount: { nodeId: discountNode?.id ?? null, discountId: discount?.discountId ?? null, title: discount?.title ?? null, status: discount?.status ?? null, functionId: discount?.appDiscountType?.functionId ?? null, discountClasses: discount?.discountClasses ?? null, combinesWith: discount?.combinesWith ?? null },
    appDiscountFunction: { queryAvailable: functionDiagnostic.available, expectedHandle: LOOPDESK_FUNCTION_HANDLE, expectedHandleFunction: functionDiagnostic.expectedHandleFunction, linkedFunction: functionDiagnostic.linkedFunction, error: "error" in functionDiagnostic ? functionDiagnostic.error : null },
    metafield: { namespace: discountNode?.metafield?.namespace ?? null, key: discountNode?.metafield?.key ?? null, type: discountNode?.metafield?.type ?? null, rawValue: discountNode?.metafield?.value ?? null, parseError: parsed.error },
    parsedConfiguration: config,
    configurationSummary: { functionContractVersion: config?.functionContractVersion ?? 1, version: config?.configurationVersion ?? null, hash: config?.configurationHash ?? null, ruleCount: rules.length, configuredRewardScopes, availableDiscountClasses, productExecutionEnabled: availableDiscountClasses.includes("PRODUCT"), orderExecutionEnabled: config?.functionContractVersion === 2 && availableDiscountClasses.includes("ORDER"), orderRuleCount, orderSuppressionReason: orderRuleCount > 0 && (config?.functionContractVersion !== 2 || !availableDiscountClasses.includes("ORDER")) ? (config?.functionContractVersion !== 2 ? "order_function_contract_unsupported" : "order_discount_class_missing") : null, currentRuleId: currentRule?.ruleId ?? null, currentCompilationVersion: currentRule?.compilationVersion ?? null, triggerProductGids, offerProductGid: currentRule?.offer?.productGid ?? null, reward: currentRule?.reward ?? null },
    runtimeSynchronization: { state: syncState, mutationUsesFunctionHandle: true, mutationFunctionHandle: LOOPDESK_FUNCTION_HANDLE, linkedToCurrentDeployedFunctionId: expectedHandleFunctionId && discount?.appDiscountType?.functionId ? expectedHandleFunctionId === discount.appDiscountType.functionId : null },
    mismatches,
  });
}
