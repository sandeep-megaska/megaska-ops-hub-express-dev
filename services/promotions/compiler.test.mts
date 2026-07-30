import test from "node:test";
import assert from "node:assert/strict";

import { compilePromotionRule, PromotionCompilationError } from "./compiler.server.ts";
import { compilePromotionRule as pureCompilePromotionRule } from "./compiler-payload.ts";
import type { PromotionCompilerRuleInput, PromotionSourceMembershipGroup } from "./compiler-domain.ts";

const p = (id: string) => `gid://shopify/Product/${id}`;
const c = (id: string) => `gid://shopify/Collection/${id}`;
let seq = 0;
function base(overrides: Partial<PromotionCompilerRuleInput & { name: string; currentCompilationId?: string | null; currentCompilation?: any; compiledAt?: Date | null }> = {}) {
  return { id: `rule-${++seq}`, shopId: "shop-a", name: "Rule", status: "ACTIVE", priority: 1, triggerType: "PRODUCT", triggerMatchMode: "ANY", minimumTriggerQuantity: 1, minimumCartSubtotal: null, triggerReferences: [{ id: "ref-1", sourceType: "PRODUCT", referenceGid: p("1") }], offerProductGid: p("999"), rewardType: "PERCENTAGE_OFF", rewardValue: "10", maximumRewardQuantity: 1, combinesWithProductDiscounts: false, combinesWithOrderDiscounts: true, combinesWithShippingDiscounts: true, currentCompilationId: null, compiledAt: null, currentCompilation: null, ...overrides } as any;
}

class FakeDb {
  rules: any[] = []; compilations: any[] = []; memberships: any[] = []; audits: any[] = []; conflictCreates = 0; failInTransaction = false;
  promotionRule = {
    findFirst: async ({ where }: any) => { const r = this.rules.find((x) => x.id === where.id && x.shopId === where.shopId) ?? null; if (!r) return null; return { ...r, triggerReferences: [...r.triggerReferences], currentCompilation: r.currentCompilationId ? this.compilations.find((c) => c.id === r.currentCompilationId) ?? null : null }; },
    update: async ({ where, data }: any) => { const r = this.rules.find((x) => x.id === where.id && (!where.shopId || x.shopId === where.shopId)); Object.assign(r, data); return r; },
  };
  promotionCompilation = {
    findFirst: async ({ where }: any) => [...this.compilations].filter((c) => c.promotionRuleId === where.promotionRuleId && (!where.status || (where.status.in ? where.status.in.includes(c.status) : c.status === where.status))).sort((a, b) => b.version - a.version)[0] ?? null,
    create: async ({ data }: any) => { if (this.conflictCreates-- > 0) { const e: any = new Error("unique"); e.code = "P2002"; throw e; } if (this.compilations.some((c) => c.promotionRuleId === data.promotionRuleId && c.version === data.version)) { const e: any = new Error("unique"); e.code = "P2002"; throw e; } const row = { id: `comp-${this.compilations.length + 1}`, ...data }; this.compilations.push(row); return row; },
    update: async ({ where, data }: any) => { const c = this.compilations.find((x) => x.id === where.id && (!where.status || x.status === where.status)); if (!c) throw new Error("not found"); Object.assign(c, data); return c; },
    updateMany: async ({ where, data }: any) => { const rows = this.compilations.filter((x) => (!where.id || x.id === where.id) && (!where.status || x.status === where.status)); rows.forEach((r) => Object.assign(r, data)); return { count: rows.length }; },
  };
  promotionCompiledMembership = { createMany: async ({ data }: any) => { for (const row of data) if (!this.memberships.some((m) => m.promotionCompilationId === row.promotionCompilationId && m.productGid === row.productGid)) this.memberships.push(row); return { count: data.length }; } };
  promotionAuditLog = { create: async ({ data }: any) => { this.audits.push(data); return data; } };
  async $transaction<T>(fn: (tx: any) => Promise<T>) { const snap = JSON.stringify({ rules: this.rules, compilations: this.compilations, memberships: this.memberships, audits: this.audits }); try { if (this.failInTransaction && this.compilations.some((c) => c.status === "COMPILING")) throw new Error("db password=secret sql detail"); return await fn(this); } catch (e) { const s = JSON.parse(snap); this.rules = s.rules; this.compilations = s.compilations; this.memberships = s.memberships; this.audits = s.audits; throw e; } }
}
async function rejectsCode(fn: () => Promise<unknown>, code: string) { await assert.rejects(fn, (e) => e instanceof PromotionCompilationError && e.code === code); }

// PRODUCT_TYPE triggers are rejected upstream by validatePromotionRule (disabled
// feature), so only PRODUCT and COLLECTION reach a successful compilation. The
// payload code still resolves PRODUCT_TYPE symmetrically if it is ever re-enabled.
for (const [type, ref, groups] of [
  ["PRODUCT", { id: "pr", sourceType: "PRODUCT", referenceGid: p("1") }, undefined],
  ["COLLECTION", { id: "co", sourceType: "COLLECTION", referenceGid: c("1") }, [{ sourceReferenceId: "co", sourceType: "COLLECTION", sourceGid: c("1"), productGids: [p("2"), p("1")], unresolved: false }]],
] as const) test(`successful ${type} compilation persists payloads, memberships, count, pointer, compiledAt`, async () => {
  const db = new FakeDb(); const rule = base({ triggerType: type as any, triggerReferences: [ref as any], triggerMatchMode: type === "PRODUCT" ? "ALL" : "ANY" }); db.rules.push(rule);
  const result = await compilePromotionRule({ shopId: "shop-a", shopDomain: "a.myshopify.com", promotionRuleId: rule.id, reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async () => ({ sourceGroups: (groups as unknown as PromotionSourceMembershipGroup[] | undefined) ?? [{ sourceReferenceId: "pr", sourceType: "PRODUCT", sourceGid: p("1"), productGids: [p("1")], unresolved: false }], pagination: [] }) });
  assert.equal(result.status, "READY"); assert.equal(db.compilations[0].version, 1); assert.equal(db.compilations[0].status, "READY"); assert.ok(db.compilations[0].storefrontPayload); assert.ok(db.compilations[0].functionPayload); assert.equal(db.compilations[0].membershipCount, db.memberships.length); assert.equal(db.rules[0].currentCompilationId, db.compilations[0].id); assert.ok(db.rules[0].compiledAt); assert.ok(db.audits.some((a) => a.action === "PROMOTION_COMPILATION_READY"));
  // The resolved membership must land in BOTH delivered payloads (drawer + Function),
  // and every group must be marked resolved — not just in membershipCount.
  const expectedGids = ((groups as unknown as PromotionSourceMembershipGroup[] | undefined) ?? [{ productGids: [p("1")] } as any]).flatMap((g: any) => g.productGids).map(String).sort();
  const sfGids = db.compilations[0].storefrontPayload.trigger.sourceGroups.flatMap((g: any) => g.productGids).map(String).sort();
  const fnGids = db.compilations[0].functionPayload.trigger.sourceGroups.flatMap((g: any) => g.productGids).map(String).sort();
  assert.deepEqual(sfGids, expectedGids, `${type} storefront payload productGids`);
  assert.deepEqual(fnGids, expectedGids, `${type} function payload productGids`);
  assert.ok(db.compilations[0].storefrontPayload.trigger.sourceGroups.every((g: any) => g.unresolved === false), `${type} storefront groups resolved`);
  assert.ok(db.compilations[0].functionPayload.trigger.sourceGroups.every((g: any) => g.unresolved === false), `${type} function groups resolved`);
});

test("large collection membership is persisted to both payloads without truncation", async () => {
  const db = new FakeDb(); const rule = base({ id: "big", triggerType: "COLLECTION", triggerReferences: [{ id: "co", sourceType: "COLLECTION", referenceGid: c("1") }], triggerMatchMode: "ANY" }); db.rules.push(rule);
  const many = Array.from({ length: 60 }, (_, i) => p(String(1000 + i)));
  await compilePromotionRule({ shopId: "shop-a", shopDomain: "a.myshopify.com", promotionRuleId: "big", reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async () => ({ sourceGroups: [{ sourceReferenceId: "co", sourceType: "COLLECTION", sourceGid: c("1"), productGids: many, unresolved: false }], pagination: [] }) });
  // Before the fix, `safe()` truncated the payload arrays to 50; assert all 60 survive.
  assert.equal(db.compilations[0].storefrontPayload.trigger.sourceGroups.flatMap((g: any) => g.productGids).length, 60);
  assert.equal(db.compilations[0].functionPayload.trigger.sourceGroups.flatMap((g: any) => g.productGids).length, 60);
  assert.equal(db.memberships.length, 60);
});

test("versioning is per-rule and unique conflicts retry then exhaust", async () => {
  const db = new FakeDb(); const a = base({ id: "a" }); const b = base({ id: "b" }); db.rules.push(a, b); db.conflictCreates = 1;
  await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "a", reason: "MANUAL_RECOMPILE" }, { database: db as any });
  await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "a", reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async (r) => ({ sourceGroups: [{ sourceReferenceId: "pr", sourceType: "PRODUCT", sourceGid: p("2"), productGids: [p("2")], unresolved: false }], pagination: [] }) });
  await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "b", reason: "MANUAL_RECOMPILE" }, { database: db as any });
  assert.deepEqual(db.compilations.filter((c) => c.promotionRuleId === "a").map((c) => c.version), [1, 2]); assert.equal(db.compilations.find((c) => c.promotionRuleId === "b")!.version, 1);
  const exhausted = new FakeDb(); exhausted.rules.push(base({ id: "x" })); exhausted.conflictCreates = 3; await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "x", reason: "MANUAL_RECOMPILE" }, { database: exhausted as any }), "VERSION_ALLOCATION_CONFLICT");
});

test("failures preserve previous current compilation and sanitized FAILED records", async () => {
  for (const [name, opts, code] of [
    ["catalogue", { catalogueResolver: async () => { throw new Error("Authorization: token"); } }, "CATALOGUE_RESOLUTION_FAILED"],
    ["empty", { catalogueResolver: async () => ({ sourceGroups: [{ sourceReferenceId: "x", sourceType: "PRODUCT", sourceGid: p("1"), productGids: [], unresolved: false }], pagination: [] }) }, "EMPTY_TRIGGER_MEMBERSHIP"],
    ["payload", { payloadCompiler: (() => { let calls = 0; return (rule: any) => { calls += 1; if (calls >= 3) throw new Error("boom"); return pureCompilePromotionRule(rule); }; })() as any }, "PAYLOAD_GENERATION_FAILED"],
  ] as const) {
    const db = new FakeDb(); const oldAt = new Date("2026-01-01T00:00:00Z"); db.compilations.push({ id: "old", promotionRuleId: "r", version: 1, status: "READY", compiledHash: "old", sourceHash: "old", triggerType: "PRODUCT", membershipCount: 1 }); db.rules.push(base({ id: "r", currentCompilationId: "old", compiledAt: oldAt }));
    await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, ({ database: db as any, ...opts } as any)), code);
    assert.equal(db.rules[0].currentCompilationId, "old", name); assert.equal(String(db.rules[0].compiledAt), String(oldAt)); assert.equal(db.compilations.at(-1)!.status, "FAILED"); assert.equal(JSON.stringify(db.compilations.at(-1)!.diagnosticPayload).includes("token"), false);
  }
});

test("source change prevents stale promotion", async () => {
  const db = new FakeDb(); const rule = base({ id: "r" }); db.rules.push(rule);
  await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async () => { rule.priority = 99; return { sourceGroups: [{ sourceReferenceId: "pr", sourceType: "PRODUCT", sourceGid: p("1"), productGids: [p("1")], unresolved: false }], pagination: [] }; } }), "SOURCE_CHANGED_DURING_COMPILATION");
  assert.equal(db.rules[0].currentCompilationId, null); assert.equal(db.memberships.length, 0);
});

test("no-op leaves old current and writes no-op audit", async () => {
  const db = new FakeDb(); const rule = base({ id: "r" }); db.rules.push(rule);
  const first = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any });
  const second = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any });
  assert.equal(second.status, "NOOP"); assert.equal(db.rules[0].currentCompilationId, first.compilationId); assert.equal(db.compilations.at(-1)!.status, "SUPERSEDED"); assert.ok(db.audits.some((a) => a.action === "PROMOTION_COMPILATION_NOOP"));
});

test("superseding marks previous READY superseded and only new current remains", async () => {
  const db = new FakeDb(); const rule = base({ id: "r" }); db.rules.push(rule);
  const first = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any });
  const second = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async () => ({ sourceGroups: [{ sourceReferenceId: "pr", sourceType: "PRODUCT", sourceGid: p("2"), productGids: [p("2")], unresolved: false }], pagination: [] }) });
  assert.equal(db.compilations.find((c) => c.id === first.compilationId)!.status, "SUPERSEDED"); assert.equal(db.rules[0].currentCompilationId, second.compilationId); assert.ok(db.audits.some((a) => a.action === "PROMOTION_COMPILATION_SUPERSEDED"));
});

test("tenant isolation uses safe not-found behavior and no cross-tenant pointer", async () => {
  const db = new FakeDb(); db.rules.push(base({ id: "r", shopId: "shop-b" }));
  await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any }), "RULE_NOT_COMPILABLE");
  assert.equal(db.rules[0].currentCompilationId, null); assert.equal(db.compilations.length, 0);
});

test("promotion transaction failure rolls back memberships and retains old current", async () => {
  const db = new FakeDb(); const oldAt = new Date("2026-01-01T00:00:00Z"); db.compilations.push({ id: "old", promotionRuleId: "r", version: 1, status: "READY", compiledHash: "old", sourceHash: "old", triggerType: "PRODUCT", membershipCount: 1 }); db.rules.push(base({ id: "r", currentCompilationId: "old", compiledAt: oldAt })); db.failInTransaction = true;
  await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "r", reason: "MANUAL_RECOMPILE" }, { database: db as any, catalogueResolver: async () => ({ sourceGroups: [{ sourceReferenceId: "pr", sourceType: "PRODUCT", sourceGid: p("2"), productGids: [p("2")], unresolved: false }], pagination: [] }) }), "PERSISTENCE_FAILED");
  assert.equal(db.rules[0].currentCompilationId, "old"); assert.equal(new Date(db.rules[0].compiledAt).toISOString(), oldAt.toISOString()); assert.equal(db.memberships.length, 0); assert.equal(db.compilations.at(-1)!.status, "FAILED");
});


test("ACTIVE and PAUSED rules can compile while DRAFT, ARCHIVED, cross-shop, and duplicate active attempts are rejected", async () => {
  for (const status of ["ACTIVE", "PAUSED"] as const) { const db = new FakeDb(); const r = base({ id: `ok-${status}`, status }); db.rules.push(r); const result = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: r.id, reason: "MANUAL_RECOMPILE" }, { database: db as any }); assert.equal(result.status, "READY"); }
  for (const status of ["DRAFT", "ARCHIVED"] as const) { const db = new FakeDb(); const r = base({ id: `bad-${status}`, status }); db.rules.push(r); await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: r.id, reason: "MANUAL_RECOMPILE" }, { database: db as any }), "RULE_NOT_COMPILABLE"); }
  { const db = new FakeDb(); db.rules.push(base({ id: "other", shopId: "shop-b" })); await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "other", reason: "MANUAL_RECOMPILE" }, { database: db as any }), "RULE_NOT_COMPILABLE"); }
  { const db = new FakeDb(); db.rules.push(base({ id: "dup" })); db.compilations.push({ id: "pending", promotionRuleId: "dup", version: 1, status: "PENDING", sourceHash: "h", triggerType: "PRODUCT", membershipCount: 0 }); await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "dup", reason: "MANUAL_RECOMPILE" }, { database: db as any }), "DUPLICATE_ACTIVE_COMPILATION"); }
});

test("recent PENDING compilation blocks a duplicate attempt", async () => {
  const db = new FakeDb(); db.rules.push(base({ id: "recent-pending" }));
  db.compilations.push({ id: "pending", promotionRuleId: "recent-pending", version: 1, status: "PENDING", reason: "MANUAL_RECOMPILE", sourceHash: "h", triggerType: "PRODUCT", membershipCount: 0, createdAt: new Date("2026-07-12T00:00:00Z") });
  await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "recent-pending", reason: "MANUAL_RECOMPILE" }, { database: db as any, clock: { now: () => new Date("2026-07-12T00:04:59Z") } }), "DUPLICATE_ACTIVE_COMPILATION");
});

test("recent COMPILING compilation blocks a duplicate attempt", async () => {
  const db = new FakeDb(); db.rules.push(base({ id: "recent-compiling" }));
  db.compilations.push({ id: "compiling", promotionRuleId: "recent-compiling", version: 1, status: "COMPILING", reason: "MANUAL_RECOMPILE", sourceHash: "h", triggerType: "PRODUCT", membershipCount: 0, createdAt: new Date("2026-07-12T00:00:00Z"), startedAt: new Date("2026-07-12T00:01:00Z") });
  await rejectsCode(() => compilePromotionRule({ shopId: "shop-a", promotionRuleId: "recent-compiling", reason: "MANUAL_RECOMPILE" }, { database: db as any, clock: { now: () => new Date("2026-07-12T00:05:59Z") } }), "DUPLICATE_ACTIVE_COMPILATION");
});

test("stale PENDING compilation is marked failed and a new compile succeeds", async () => {
  const db = new FakeDb(); db.rules.push(base({ id: "stale-pending" }));
  db.compilations.push({ id: "pending", promotionRuleId: "stale-pending", version: 1, status: "PENDING", reason: "MANUAL_RECOMPILE", sourceHash: "h", triggerType: "PRODUCT", membershipCount: 0, createdAt: new Date("2026-07-12T00:00:00Z") });
  const result = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "stale-pending", reason: "MANUAL_RECOMPILE" }, { database: db as any, clock: { now: () => new Date("2026-07-12T00:06:00Z") } });
  assert.equal(result.status, "READY");
  assert.equal(db.compilations[0].status, "FAILED");
  assert.equal(db.compilations[0].errorCode, "STALE_COMPILATION_RECOVERED");
  assert.ok(db.audits.some((a) => a.action === "PROMOTION_COMPILATION_STALE_RECOVERED"));
});

test("stale COMPILING compilation is marked failed and a new compile succeeds", async () => {
  const db = new FakeDb(); db.rules.push(base({ id: "stale-compiling" }));
  db.compilations.push({ id: "compiling", promotionRuleId: "stale-compiling", version: 1, status: "COMPILING", reason: "MANUAL_RECOMPILE", sourceHash: "h", triggerType: "PRODUCT", membershipCount: 0, createdAt: new Date("2026-07-12T00:00:00Z"), startedAt: new Date("2026-07-12T00:00:30Z") });
  const result = await compilePromotionRule({ shopId: "shop-a", promotionRuleId: "stale-compiling", reason: "MANUAL_RECOMPILE" }, { database: db as any, clock: { now: () => new Date("2026-07-12T00:06:00Z") } });
  assert.equal(result.status, "READY");
  assert.equal(db.compilations[0].status, "FAILED");
  assert.equal(db.compilations[0].errorCode, "STALE_COMPILATION_RECOVERED");
});
