import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.ts";
import { assembleFunctionConfiguration, assertFunctionConfigurationEqual, buildConfigurationHash, isRecognizedAutomaticDiscountTitle, resolveFunctionCapabilities, type LoopDeskFunctionConfiguration, type PromotionRuntimeSyncResult } from "./function-contract.ts";
import { createAutomaticDiscount, ensureAutomaticDiscountClasses, findCanonicalAutomaticDiscount, readAutomaticDiscount, readShopifyFunctionByHandle, verifyDiscountOwnsCanonicalConfiguration, writeFunctionConfigurationMetafield, type DiscountSnapshot, type ShopifyGraphql } from "./shopify-discount.server.ts";
import { compilationContractVersion, mapCompilationToFunctionRule } from "./mapper.ts";

type RuntimeSyncState = { id: string; shopId: string; synchronizationState?: string | null; shopifyAutomaticDiscountId?: string | null; lastRulesFingerprint?: string | null; lastDeployedConfigurationVersion?: number | null; lastDeployedConfigurationHash?: string | null; lastDeployedRuleCount?: number | null; lastSuccessfulSyncAt?: Date | null; lastVerifiedConfiguration?: unknown; synchronizationAttemptId?: string | null; synchronizationLeaseExpiresAt?: Date | null };
type Db = { shop: { findUnique(args: object): Promise<{ id: string; shopDomain: string | null } | null> }; promotionRuntimeSyncState: { upsert(args: object): Promise<RuntimeSyncState>; update(args: object): Promise<RuntimeSyncState>; updateMany(args: object): Promise<{ count: number }> }; promotionRule: { findMany(args: object): Promise<unknown[]> } };
type Deps = { database?: Db; graphql?: ShopifyGraphql; clock?: { now(): Date } };
type Input = { shopId: string };

function safeMessage(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/shpat_[A-Za-z0-9_\-]+|Bearer\s+\S+|authorization|token|secret|password/gi, "[redacted]").slice(0, 500); }
function failure(code: string, error: unknown, retryable = true): PromotionRuntimeSyncResult { return { ok: false, code, message: safeMessage(error), retryable }; }
function rulesFingerprint(rules: LoopDeskFunctionConfiguration["rules"], functionContractVersion: 1 | 2) { return buildConfigurationHash({ configurationVersion: 1, rules, functionContractVersion }); }
function syncErrorCode(error: unknown) { const message = safeMessage(error); if (/unsupported Function contract version/i.test(message)) return "sync_contract_version_mismatch"; if (/missing the ORDER discount class/i.test(message)) return "sync_discount_class_update_failed"; if (/metafield/i.test(message)) return "sync_metafield_publication_failed"; if (/Multiple LoopDesk automatic discounts/i.test(message)) return "sync_automatic_discount_duplicate"; if (/was not found|did not return the automatic discount owner/i.test(message)) return "sync_automatic_discount_missing"; if (/did not match/i.test(message)) return "sync_configuration_hash_mismatch"; if (/current LoopDesk Function/i.test(message)) return "sync_function_id_mismatch"; if (/read-back|not ACTIVE|combination state/i.test(message)) return "sync_shopify_verification_failed"; return message === "sync_order_function_contract_unsupported" ? message : "SYNC_FAILED"; }
function leaseUntil(now: Date) { return new Date(now.getTime() + 2 * 60 * 1000); }
function diagnostics(configuration: LoopDeskFunctionConfiguration, discount: DiscountSnapshot) { const capability = resolveFunctionCapabilities(configuration); return { compiledContractVersion: capability.contractVersion, configuredFunctionContractVersion: capability.contractVersion, compilationVersion: configuration.configurationVersion, productRuleCount: configuration.rules.filter((rule) => rule.reward.scope === "product").length, orderRuleCount: configuration.rules.filter((rule) => rule.reward.scope === "order").length, requiredDiscountClasses: capability.requiredDiscountClasses, actualDiscountClasses: [...(discount.discountClasses ?? [])], automaticDiscountIdPresent: true, automaticDiscountId: discount.id, automaticDiscountFunctionId: discount.appDiscountType?.functionId ?? null, compiledConfigurationHash: configuration.configurationHash, publishedConfigurationHash: configuration.configurationHash, configurationHashMatched: true, metafieldPublicationStatus: "VERIFIED" as const, verificationStatus: "VERIFIED" as const, duplicateAutomaticDiscountCount: 0, synchronization: "healthy" as const, publicationBlockers: [] }; }

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
    const fingerprint = rulesFingerprint(rules, functionContractVersion);
    const configurationVersion = state.lastRulesFingerprint === fingerprint && state.lastDeployedConfigurationVersion ? state.lastDeployedConfigurationVersion : (state.lastDeployedConfigurationVersion ?? 0) + 1;
    const configuration = assembleFunctionConfiguration({ configurationVersion, rules, functionContractVersion });
    const capabilities = resolveFunctionCapabilities(configuration);
    if (orderRewardsEnabled && !capabilities.supportsOrderDiscounts) throw new Error("sync_order_function_contract_unsupported");
    const loopdeskFunction = await readShopifyFunctionByHandle(graphql, shop.shopDomain);

    // Search on every attempt, even when a stored owner exists. The stored ID is the
    // strongest ownership marker; the canonical search additionally detects stale
    // records and duplicate active LoopDesk discounts before anything is published.
    const storedDiscount = state.shopifyAutomaticDiscountId ? await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId) : null;
    const canonicalDiscount = await findCanonicalAutomaticDiscount(graphql, shop.shopDomain);
    if (isRecognizedAutomaticDiscountTitle(storedDiscount?.title) && canonicalDiscount && storedDiscount!.id !== canonicalDiscount.id) throw new Error("Multiple LoopDesk automatic discounts match canonical ownership markers; ownership is ambiguous.");
    let discount = isRecognizedAutomaticDiscountTitle(storedDiscount?.title) ? storedDiscount : canonicalDiscount;
    let outcome: "CREATED" | "UPDATED" | "UNCHANGED" = state.lastRulesFingerprint === fingerprint ? "UNCHANGED" : "UPDATED";
    if (!discount) { discount = await createAutomaticDiscount(graphql, shop.shopDomain, now.toISOString(), { supportsOrderDiscounts: capabilities.supportsOrderDiscounts }); outcome = "CREATED"; }
    const preservedCombinations = discount.combinesWith ?? null;
    if (!discount.discountClasses?.includes("PRODUCT") || capabilities.requiredDiscountClasses.some((discountClass) => !discount?.discountClasses?.includes(discountClass))) {
      await ensureAutomaticDiscountClasses(graphql, shop.shopDomain, discount.id, discount.discountClasses ?? [], capabilities.supportsOrderDiscounts);
      const updatedDiscount = await readAutomaticDiscount(graphql, shop.shopDomain, discount.id);
      if (!updatedDiscount) throw new Error("Shopify automatic discount was not found after its discount classes were updated.");
      discount = updatedDiscount;
    }

    if (state.lastRulesFingerprint === fingerprint && state.shopifyAutomaticDiscountId && state.lastDeployedConfigurationVersion) {
      if (discount.metafield?.value) {
        try { assertFunctionConfigurationEqual(configuration, JSON.parse(discount.metafield.value)); verifyDiscountOwnsCanonicalConfiguration(discount, configuration, loopdeskFunction.id, preservedCombinations); await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "SYNCED", synchronizationAttemptId: null, synchronizationLeaseExpiresAt: null, shopifyAutomaticDiscountId: discount.id, lastSuccessfulSyncAt: clock.now(), lastErrorCode: null, lastErrorMessage: null } }); return { ok: true, outcome: "UNCHANGED", automaticDiscountId: discount.id, configurationVersion, configurationHash: configuration.configurationHash, ruleCount: configuration.rules.length, verifiedAt: clock.now().toISOString(), diagnostics: diagnostics(configuration, discount) }; } catch { /* stale publication is repaired below */ }
      }
    }
    await writeFunctionConfigurationMetafield(graphql, shop.shopDomain, discount.id, configuration);
    const readBack = await readAutomaticDiscount(graphql, shop.shopDomain, discount.id);
    verifyDiscountOwnsCanonicalConfiguration(readBack, configuration, loopdeskFunction.id, preservedCombinations);
    const verifiedAt = clock.now();
    const finalized = await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "SYNCED", synchronizationAttemptId: null, synchronizationLeaseExpiresAt: null, shopifyAutomaticDiscountId: discount.id, lastDeployedConfigurationVersion: configurationVersion, lastDeployedConfigurationHash: configuration.configurationHash, lastRulesFingerprint: fingerprint, lastDeployedRuleCount: configuration.rules.length, lastSuccessfulSyncAt: verifiedAt, lastVerifiedConfiguration: configuration, lastErrorCode: null, lastErrorMessage: null } });
    if (finalized.count !== 1) return failure("STALE_SYNC_ATTEMPT", "Promotion Function synchronization attempt was superseded before finalization.", true);
    return { ok: true, outcome: outcome === "UNCHANGED" ? "UPDATED" : outcome, automaticDiscountId: discount.id, configurationVersion: configurationVersion, configurationHash: configuration.configurationHash, ruleCount: configuration.rules.length, verifiedAt: verifiedAt.toISOString(), diagnostics: diagnostics(configuration, readBack!) };
  } catch (error) {
    const code = syncErrorCode(error);
    if (state) await database.promotionRuntimeSyncState.updateMany({ where: { id: state.id, synchronizationAttemptId: attemptId }, data: { synchronizationState: "FAILED", synchronizationAttemptId: null, synchronizationLeaseExpiresAt: null, lastErrorCode: code, lastErrorMessage: safeMessage(error), lastAttemptedAt: now } }).catch(() => undefined);
    return failure(code, error);
  }
}
