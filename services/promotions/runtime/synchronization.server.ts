import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.ts";
import { assembleFunctionConfiguration, assertFunctionConfigurationEqual, buildConfigurationHash, resolveFunctionCapabilities, type LoopDeskFunctionConfiguration, type PromotionRuntimeSyncResult } from "./function-contract.ts";
import { createAutomaticDiscount, ensureAutomaticDiscountClasses, ensureAutomaticDiscountCombinations, findCanonicalAutomaticDiscount, readAutomaticDiscount, readShopifyFunctionByHandle, verifyDiscountOwnsCanonicalConfiguration, writeFunctionConfigurationMetafield, type ShopifyGraphql } from "./shopify-discount.server.ts";
import { compilationContractVersion, mapCompilationToFunctionRule } from "./mapper.ts";

type RuntimeSyncState = { id: string; shopId: string; synchronizationState?: string | null; shopifyAutomaticDiscountId?: string | null; lastRulesFingerprint?: string | null; lastDeployedConfigurationVersion?: number | null; lastDeployedConfigurationHash?: string | null; lastDeployedRuleCount?: number | null; lastSuccessfulSyncAt?: Date | null; lastVerifiedConfiguration?: unknown; synchronizationAttemptId?: string | null; synchronizationLeaseExpiresAt?: Date | null };
type Db = { shop: { findUnique(args: object): Promise<{ id: string; shopDomain: string | null } | null> }; promotionRuntimeSyncState: { upsert(args: object): Promise<RuntimeSyncState>; update(args: object): Promise<RuntimeSyncState>; updateMany(args: object): Promise<{ count: number }> }; promotionRule: { findMany(args: object): Promise<unknown[]> } };
type Deps = { database?: Db; graphql?: ShopifyGraphql; clock?: { now(): Date } };
type Input = { shopId: string };

function safeMessage(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/shpat_[A-Za-z0-9_\-]+|Bearer\s+\S+|authorization|token|secret|password/gi, "[redacted]").slice(0, 500); }
function failure(code: string, error: unknown, retryable = true): PromotionRuntimeSyncResult { return { ok: false, code, message: safeMessage(error), retryable }; }
function rulesFingerprint(rules: LoopDeskFunctionConfiguration["rules"], functionContractVersion: 1 | 2) { return buildConfigurationHash({ configurationVersion: 1, rules, functionContractVersion }); }
function syncErrorCode(error: unknown) { const message = safeMessage(error); if (/missing the ORDER discount class/i.test(message)) return "ORDER_CLASS_UPDATE_FAILED"; if (/metafield/i.test(message)) return "METAFIELD_PUBLICATION_FAILED"; if (/Multiple LoopDesk automatic discounts/i.test(message)) return "AUTOMATIC_DISCOUNT_DUPLICATED"; if (/was not found|did not return the automatic discount owner/i.test(message)) return "AUTOMATIC_DISCOUNT_NOT_FOUND"; if (/did not match/i.test(message)) return "CONFIGURATION_HASH_MISMATCH"; if (/read-back|not ACTIVE|current LoopDesk Function|combination state/i.test(message)) return "SHOPIFY_VERIFICATION_FAILED"; return message === "order_function_contract_unsupported" ? message : "SYNC_FAILED"; }
function leaseUntil(now: Date) { return new Date(now.getTime() + 2 * 60 * 1000); }
function diagnostics(configuration: LoopDeskFunctionConfiguration, actualClasses: readonly string[], automaticDiscountId: string) { const capability = resolveFunctionCapabilities(configuration); return { compiledContractVersion: capability.contractVersion, configuredFunctionContractVersion: capability.contractVersion, productRuleCount: configuration.rules.filter((rule) => rule.reward.scope === "product").length, orderRuleCount: configuration.rules.filter((rule) => rule.reward.scope === "order").length, requiredDiscountClasses: capability.supportsOrderDiscounts ? ["PRODUCT", "ORDER"] : ["PRODUCT"], actualDiscountClasses: [...actualClasses], automaticDiscountId, configurationHashMatched: true, synchronization: "healthy" as const, publicationBlockers: [] }; }

async function resolveGraphqlClient(injected?: ShopifyGraphql): Promise<ShopifyGraphql> {
  if (injected) return injected;
  const { shopifyAdminGraphql } = await import("../../shopify/admin.ts");
  return shopifyAdminGraphql;
}

export async function synchronizePromotionFunctionConfiguration(input: Input, deps: Deps = {}): Promise<PromotionRuntimeSyncResult> {
  const database = deps.database ?? prisma as unknown as Db;
  const graphql = await resolveGraphqlClient(deps.graphql);
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  const attemptId = randomUUID();
  let state: RuntimeSyncState | null = null;
  try {
    const shop = await database.shop.findUnique({ where: { id: input.shopId } });
    if (!shop) return failure("SHOP_NOT_FOUND", "Shop was not found.", false);
    state = await database.promotionRuntimeSyncState.upsert({ where: { shopId: input.shopId }, create: { shopId: input.shopId, synchronizationState: "NEVER_SYNCED" }, update: {} });
    const leased = await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, OR: [{ synchronizationLeaseExpiresAt: null }, { synchronizationLeaseExpiresAt: { lt: now } }, { synchronizationState: { not: "SYNCING" } }] }, data: { synchronizationState: "SYNCING", synchronizationAttemptId: attemptId, synchronizationLeaseExpiresAt: leaseUntil(now), lastAttemptedAt: now, lastErrorCode: null, lastErrorMessage: null } });
    if (leased.count !== 1) return failure("SYNC_IN_PROGRESS", "Another promotion Function synchronization is already in progress.", true);
    state = { ...state, synchronizationState: "SYNCING", synchronizationAttemptId: attemptId };

    const ruleRecords = await database.promotionRule.findMany({ where: { shopId: input.shopId, status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null, currentCompilation: { is: { status: "READY" } } }, include: { currentCompilation: true } });
    const rules = ruleRecords.map((record) => mapCompilationToFunctionRule(record as never));
    const orderRewardsEnabled = rules.some((rule) => rule.reward.scope === "order");
    const functionContractVersion: 1 | 2 = ruleRecords.some((record) => compilationContractVersion(record as never) === 2) || orderRewardsEnabled ? 2 : 1;
    const capabilities = resolveFunctionCapabilities({ functionContractVersion });
    if (orderRewardsEnabled && !capabilities.supportsOrderDiscounts) throw new Error("order_function_contract_unsupported");
    const fingerprint = rulesFingerprint(rules, functionContractVersion);
    if (state.lastRulesFingerprint === fingerprint && state.shopifyAutomaticDiscountId && state.lastDeployedConfigurationVersion) {
      let snapshot = await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId);
      if (snapshot && capabilities.supportsOrderDiscounts && !snapshot.discountClasses?.includes("ORDER")) {
        await ensureAutomaticDiscountClasses(graphql, shop.shopDomain, snapshot.id, snapshot.discountClasses ?? [], true);
        snapshot = await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId);
      }
      if (orderRewardsEnabled) await ensureAutomaticDiscountCombinations(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId);
      if (snapshot?.metafield?.value) {
        try { const intended = assembleFunctionConfiguration({ configurationVersion: state.lastDeployedConfigurationVersion, rules, functionContractVersion }); assertFunctionConfigurationEqual(intended, JSON.parse(snapshot.metafield.value)); await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "SYNCED", synchronizationLeaseExpiresAt: null, lastSuccessfulSyncAt: clock.now(), lastErrorCode: null, lastErrorMessage: null } }); return { ok: true, outcome: "UNCHANGED", automaticDiscountId: state.shopifyAutomaticDiscountId, configurationVersion: state.lastDeployedConfigurationVersion, configurationHash: state.lastDeployedConfigurationHash || "", ruleCount: state.lastDeployedRuleCount || 0, verifiedAt: (state.lastSuccessfulSyncAt ?? now).toISOString(), diagnostics: diagnostics(intended, snapshot.discountClasses ?? [], snapshot.id) }; } catch { /* repair below */ }
      }
    }
    const version = (state.lastDeployedConfigurationVersion ?? 0) + 1;
    const configuration = assembleFunctionConfiguration({ configurationVersion: version, rules, functionContractVersion });
    const loopdeskFunction = await readShopifyFunctionByHandle(graphql, shop.shopDomain);
    let discount = state.shopifyAutomaticDiscountId ? await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId) : null;
    let outcome: "CREATED" | "UPDATED" = "UPDATED";
    if (discount && discount.title !== "LoopDesk Universal Promotions") discount = null;
    if (!discount) {
      discount = state.shopifyAutomaticDiscountId ? null : await findCanonicalAutomaticDiscount(graphql, shop.shopDomain);
      if (!discount) { discount = await createAutomaticDiscount(graphql, shop.shopDomain, now.toISOString(), { supportsOrderDiscounts: capabilities.supportsOrderDiscounts }); outcome = "CREATED"; }
    }
    if (!discount.discountClasses?.includes("PRODUCT") || (capabilities.supportsOrderDiscounts && !discount.discountClasses?.includes("ORDER"))) {
      await ensureAutomaticDiscountClasses(graphql, shop.shopDomain, discount.id, discount.discountClasses ?? [], capabilities.supportsOrderDiscounts);
    }
    if (orderRewardsEnabled) await ensureAutomaticDiscountCombinations(graphql, shop.shopDomain, discount.id);
    await writeFunctionConfigurationMetafield(graphql, shop.shopDomain, discount.id, configuration);
    const readBack = await readAutomaticDiscount(graphql, shop.shopDomain, discount.id);
    verifyDiscountOwnsCanonicalConfiguration(readBack, configuration, loopdeskFunction.id);
    const verifiedAt = clock.now();
    const finalized = await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "SYNCED", synchronizationAttemptId: null, synchronizationLeaseExpiresAt: null, shopifyAutomaticDiscountId: discount.id, lastDeployedConfigurationVersion: version, lastDeployedConfigurationHash: configuration.configurationHash, lastRulesFingerprint: fingerprint, lastDeployedRuleCount: configuration.rules.length, lastSuccessfulSyncAt: verifiedAt, lastVerifiedConfiguration: configuration, lastErrorCode: null, lastErrorMessage: null } });
    if (finalized.count !== 1) return failure("STALE_SYNC_ATTEMPT", "Promotion Function synchronization attempt was superseded before finalization.", true);
    return { ok: true, outcome, automaticDiscountId: discount.id, configurationVersion: version, configurationHash: configuration.configurationHash, ruleCount: configuration.rules.length, verifiedAt: verifiedAt.toISOString(), diagnostics: diagnostics(configuration, readBack?.discountClasses ?? [], discount.id) };
  } catch (error) {
    const code = syncErrorCode(error);
    if (state) await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "FAILED", synchronizationAttemptId: null, synchronizationLeaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: safeMessage(error), lastAttemptedAt: now } }).catch(() => undefined);
    return failure(code, error);
  }
}
