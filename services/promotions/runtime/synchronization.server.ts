import { prisma } from "../../db/prisma.ts";
import { shopifyAdminGraphql } from "../../shopify/admin.ts";
import { assembleFunctionConfiguration, assertFunctionConfigurationEqual, buildConfigurationHash, type LoopDeskFunctionConfiguration, type PromotionRuntimeSyncResult } from "./function-contract.ts";
import { createAutomaticDiscount, findCanonicalAutomaticDiscount, readAutomaticDiscount, writeFunctionConfigurationMetafield, type ShopifyGraphql } from "./shopify-discount.server.ts";
import { mapCompilationToFunctionRule } from "./mapper.ts";

type Db = any;
type Deps = { database?: Db; graphql?: ShopifyGraphql; clock?: { now(): Date } };
type Input = { shopId: string; actorId?: string | null };

function safeMessage(error: unknown) { return String(error instanceof Error ? error.message : error).replace(/shpat_[A-Za-z0-9_\-]+|Bearer\s+\S+|authorization|token/gi, "[redacted]").slice(0, 500); }
function failure(code: string, error: unknown, retryable = true): PromotionRuntimeSyncResult { return { ok: false, code, message: safeMessage(error), retryable }; }
function rulesFingerprint(rules: LoopDeskFunctionConfiguration["rules"]) { return buildConfigurationHash({ configurationVersion: 1, rules }); }

export async function synchronizePromotionFunctionConfiguration(input: Input, deps: Deps = {}): Promise<PromotionRuntimeSyncResult> {
  const database = deps.database ?? prisma;
  const graphql = deps.graphql ?? shopifyAdminGraphql;
  const clock = deps.clock ?? { now: () => new Date() };
  const now = clock.now();
  let stateId: string | null = null;
  try {
    const shop = await database.shop.findUnique({ where: { id: input.shopId } });
    if (!shop) return failure("SHOP_NOT_FOUND", "Shop was not found.", false);
    const state = await database.promotionRuntimeSyncState.upsert({ where: { shopId: input.shopId }, create: { shopId: input.shopId, synchronizationState: "SYNCING", lastAttemptedAt: now }, update: { synchronizationState: "SYNCING", lastAttemptedAt: now, lastErrorCode: null, lastErrorMessage: null } });
    stateId = state.id;
    const ruleRecords = await database.promotionRule.findMany({ where: { shopId: input.shopId, status: { in: ["ACTIVE", "PAUSED"] }, archivedAt: null, currentCompilation: { is: { status: "READY" } } }, include: { currentCompilation: true } });
    const rules = ruleRecords.map(mapCompilationToFunctionRule);
    const fingerprint = rulesFingerprint(rules);
    if (state.synchronizationState === "SYNCED" && state.lastRulesFingerprint === fingerprint && state.shopifyAutomaticDiscountId) {
      const snapshot = await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId);
      if (snapshot?.metafield?.value) {
        try { assertFunctionConfigurationEqual(assembleFunctionConfiguration({ configurationVersion: state.lastDeployedConfigurationVersion || 1, rules }), JSON.parse(snapshot.metafield.value)); return { ok: true, outcome: "UNCHANGED", automaticDiscountId: state.shopifyAutomaticDiscountId, configurationVersion: state.lastDeployedConfigurationVersion || 1, configurationHash: state.lastDeployedConfigurationHash || "", ruleCount: state.lastDeployedRuleCount || 0, verifiedAt: (state.lastSuccessfulSyncAt ?? now).toISOString() }; } catch { /* recovery write */ }
      }
    }
    const version = (state.lastDeployedConfigurationVersion ?? 0) + 1;
    const configuration = assembleFunctionConfiguration({ configurationVersion: version, rules });
    let discount = state.shopifyAutomaticDiscountId ? await readAutomaticDiscount(graphql, shop.shopDomain, state.shopifyAutomaticDiscountId) : null;
    let outcome: "CREATED" | "UPDATED" = "UPDATED";
    if (!discount) discount = await findCanonicalAutomaticDiscount(graphql, shop.shopDomain);
    if (!discount) { discount = await createAutomaticDiscount(graphql, shop.shopDomain, now.toISOString()); outcome = "CREATED"; }
    await database.promotionRuntimeSyncState.update({ where: { id: state.id }, data: { shopifyAutomaticDiscountId: discount.id } });
    await writeFunctionConfigurationMetafield(graphql, shop.shopDomain, discount.id, configuration);
    const readBack = await readAutomaticDiscount(graphql, shop.shopDomain, discount.id);
    if (!readBack?.metafield?.value) throw new Error("Shopify read-back did not include the Function configuration metafield.");
    const parsed = JSON.parse(readBack.metafield.value) as unknown;
    assertFunctionConfigurationEqual(configuration, parsed);
    const verifiedAt = clock.now();
    await database.promotionRuntimeSyncState.update({ where: { id: state.id }, data: { synchronizationState: "SYNCED", shopifyAutomaticDiscountId: discount.id, lastDeployedConfigurationVersion: version, lastDeployedConfigurationHash: configuration.configurationHash, lastRulesFingerprint: fingerprint, lastDeployedRuleCount: configuration.rules.length, lastSuccessfulSyncAt: verifiedAt, lastVerifiedConfiguration: configuration, lastErrorCode: null, lastErrorMessage: null } });
    return { ok: true, outcome, automaticDiscountId: discount.id, configurationVersion: version, configurationHash: configuration.configurationHash, ruleCount: configuration.rules.length, verifiedAt: verifiedAt.toISOString() };
  } catch (error) {
    if (stateId) await database.promotionRuntimeSyncState.update({ where: { id: stateId }, data: { synchronizationState: "FAILED", lastErrorCode: "SYNC_FAILED", lastErrorMessage: safeMessage(error), lastAttemptedAt: now } }).catch(() => undefined);
    return failure("SYNC_FAILED", error);
  }
}
