import test from "node:test";
import assert from "node:assert/strict";
import { derivePromotionExecutionStatus, getPromotionCompilationReadModel, safeCompilationFailureMessage } from "./compiler-admin-read-model.server.ts";
import type { PromotionRuleRecord } from "./repository.server.ts";
const now = new Date("2026-07-11T10:00:00Z");
function rule(partial: Partial<PromotionRuleRecord> = {}): PromotionRuleRecord { return { id: partial.id ?? "r1", shopId: partial.shopId ?? "shop-a", name: "Rule", status: partial.status ?? "DRAFT", priority: 1, triggerType: "PRODUCT", triggerMatchMode: "ANY", minimumTriggerQuantity: 1, offerProductGid: "gid://shopify/Product/1", rewardType: "PERCENTAGE_OFF", rewardValue: 10, maximumRewardQuantity: 1, currentCompilationId: partial.currentCompilationId ?? null, compiledAt: partial.compiledAt ?? null, createdAt: now, updatedAt: now, triggerReferences: [], } as PromotionRuleRecord; }
function comp(partial: any) { return { id: partial.id ?? `c${partial.version}`, promotionRuleId: "r1", version: partial.version, status: partial.status, reason: partial.reason ?? "MANUAL_RECOMPILE", sourceHash: partial.sourceHash ?? "abcdef1234567890", compiledHash: partial.compiledHash ?? "fedcba9876543210", membershipCount: partial.membershipCount ?? 0, requestedAt: partial.requestedAt ?? now, startedAt: partial.startedAt ?? null, completedAt: partial.completedAt ?? null, errorCode: partial.errorCode ?? null, errorMessage: partial.errorMessage ?? null, diagnosticPayload: partial.diagnosticPayload ?? null }; }
class Db { rules: any[] = []; comps: any[] = []; promotionRule = { findFirst: async ({ where }: any) => { const r = this.rules.find((x) => x.id === where.id && x.shopId === where.shopId); return r ? { ...r, currentCompilation: r.currentCompilationId ? this.comps.find((c) => c.id === r.currentCompilationId) ?? null : null } : null; } }; promotionCompilation = { findMany: async ({ where, take }: any) => this.comps.filter((c) => c.promotionRuleId === where.promotionRuleId).sort((a, b) => b.version - a.version).slice(0, take) }; }

test("derives requested execution states", () => {
  assert.equal(derivePromotionExecutionStatus("DRAFT", null, null), "NOT_COMPILED");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", null, null), "PENDING");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", null, comp({ version: 1, status: "PENDING" })), "PENDING");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", null, comp({ version: 1, status: "COMPILING" })), "COMPILING");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", comp({ version: 1, status: "READY" }), comp({ version: 1, status: "READY" })), "READY");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", null, comp({ version: 1, status: "FAILED" })), "FAILED");
  assert.equal(derivePromotionExecutionStatus("ACTIVE", comp({ version: 1, status: "READY" }), comp({ version: 2, status: "FAILED" })), "READY_WITH_FAILED_RECOMPILE");
});

test("keeps current ready and latest failed distinct with safe summaries", async () => {
  const db = new Db(); db.rules.push(rule({ status: "ACTIVE", currentCompilationId: "c1", compiledAt: now })); db.comps.push(comp({ id: "c1", version: 1, status: "READY", membershipCount: 2, completedAt: now }), comp({ id: "c2", version: 2, status: "FAILED", membershipCount: 0, errorCode: "SOURCE_CHANGED_DURING_COMPILATION", errorMessage: "raw sql stack", diagnosticPayload: { schemaVersion: 1, sourceGroupCount: 3, pagesFetched: 4, productsSeen: 5, uniqueProducts: 2, token: "secret" } }));
  const model = await getPromotionCompilationReadModel("shop-a", "r1", { historyLimit: 10 }, db as any);
  assert.equal(model.code, "READY_WITH_FAILED_RECOMPILE");
  assert.equal(model.currentCompilation?.version, 1);
  assert.equal(model.currentCompilation?.membershipCount, 2);
  assert.equal(model.currentCompilation?.sourceHashShort, "abcdef123456");
  assert.equal(model.latestAttempt?.version, 2);
  assert.equal(model.latestAttempt?.safeErrorCode, "SOURCE_CHANGED_DURING_COMPILATION");
  assert.equal(model.latestAttempt?.safeErrorMessage?.includes("stack"), false);
  assert.equal(JSON.stringify(model).includes("secret"), false);
  assert.equal(JSON.stringify(model).includes("raw sql"), false);
});

test("history is newest first and limited", async () => { const db = new Db(); db.rules.push(rule({ status: "ACTIVE" })); db.comps.push(comp({ version: 1, status: "FAILED" }), comp({ version: 2, status: "FAILED" }), comp({ version: 3, status: "FAILED" })); const model = await getPromotionCompilationReadModel("shop-a", "r1", { historyLimit: 2 }, db as any); assert.deepEqual(model.history.map((h) => h.version), [3, 2]); });

test("maps safe failure messages", () => { assert.match(safeCompilationFailureMessage("EMPTY_TRIGGER_MEMBERSHIP"), /No qualifying products/); assert.match(safeCompilationFailureMessage("CATALOGUE_RESOLUTION_FAILED"), /could not resolve/); assert.match(safeCompilationFailureMessage("NOPE"), /could not be completed/); });
