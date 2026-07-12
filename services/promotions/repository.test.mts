import test from "node:test";
import assert from "node:assert/strict";

import { archivePromotionRule, changePromotionRuleStatus, createPromotionRule, getPromotionRuleById, listPromotionCompilations, listPromotionRules, PromotionRuleNotFoundError, PromotionRuleTransitionError, PromotionRuleValidationError, replacePromotionTriggerReferences, updatePromotionRule, type PromotionRuleRecord, type PromotionTriggerReferenceRecord } from "./repository.server.ts";


class DecimalLike {
  private readonly value: string;
  constructor(value: string) { this.value = value; }
  toString() { return this.value; }
}

const base = (shopId = "shop-a") => ({ shopId, name: "  Sock Offer  ", triggerType: "PRODUCT" as const, triggerReferences: [{ sourceType: "PRODUCT" as const, referenceGid: " 123 " }, { sourceType: "PRODUCT" as const, referenceGid: "gid://shopify/Product/123" }], offerProductGid: " 456 ", rewardType: "PERCENTAGE_OFF" as const, rewardValue: "10", minimumTriggerQuantity: 1, maximumRewardQuantity: 1, actor: { actorType: "USER", actorId: "u1" } });

type Audit = { shopId: string; promotionRuleId: string; action: string; previousState?: unknown; nextState?: unknown };
class Db {
  rules: PromotionRuleRecord[] = [];
  refs: PromotionTriggerReferenceRecord[] = [];
  audits: Audit[] = [];
  compilations = [{ id: "c1", promotionRuleId: "foreign", version: 1, status: "READY", reason: "RULE_UPDATED", sourceHash: "s", triggerType: "PRODUCT" as const, membershipCount: 1 }, { id: "c2", promotionRuleId: "r1", version: 2, status: "READY", reason: "RULE_UPDATED", sourceHash: "s2", triggerType: "PRODUCT" as const, membershipCount: 2 }];
  failAudit = false;
  seq = 1;
  promotionRule: { findFirst(args: any): Promise<PromotionRuleRecord | null>; findMany(args: any): Promise<PromotionRuleRecord[]>; create(args: any): Promise<PromotionRuleRecord>; update(args: any): Promise<PromotionRuleRecord> } = {
    findFirst: async (_args: any) => null,
    findMany: async (_args: any) => [],
    create: async (_args: any) => { throw new Error("not implemented"); },
    update: async (_args: any) => { throw new Error("not implemented"); },
  };
  promotionTriggerReference = { deleteMany: async (_args: any) => ({ count: 0 }), createMany: async (_args: any) => ({ count: 0 }) };
  promotionAuditLog = { create: async (_args: any) => ({}) };
  promotionCompilation: { findMany(args: any): Promise<Array<{ id: string; promotionRuleId: string; version: number; status: string; reason: string; sourceHash: string; triggerType: "PRODUCT"; membershipCount: number }>> } = { findMany: async (_args: any) => [] };
  constructor() {
    this.promotionRule.findFirst = async (args: any) => this.withRefs(this.rules.find((r) => (!args.where.id || r.id === args.where.id) && (!args.where.shopId || r.shopId === args.where.shopId)) ?? null);
    this.promotionRule.findMany = async (args: any) => this.rules.filter((r) => r.shopId === args.where.shopId && (args.where.status?.not ? r.status !== args.where.status.not : true) && ("archivedAt" in args.where ? (r.archivedAt ?? null) === args.where.archivedAt : true)).map((r) => this.withRefs(r)!);
    this.promotionRule.create = async (args: any) => { const id = `r${this.seq++}`; const now = new Date(); const { triggerReferences, ...data } = args.data; const rule = { id, createdAt: now, updatedAt: now, archivedAt: null, currentCompilationId: data.currentCompilationId ?? null, compiledAt: data.compiledAt ?? null, ...data } as PromotionRuleRecord; this.rules.push(rule); for (const ref of triggerReferences?.createMany?.data ?? []) this.refs.push({ id: `t${this.seq++}`, promotionRuleId: id, ...ref }); return this.withRefs(rule)!; };
    this.promotionRule.update = async (args: any) => { const rule = this.rules.find((r) => r.id === args.where.id); assert.ok(rule); Object.assign(rule, args.data, { updatedAt: new Date() }); return this.withRefs(rule)!; };
    this.promotionTriggerReference.deleteMany = async (args: any) => { const before = this.refs.length; this.refs = this.refs.filter((r) => r.promotionRuleId !== args.where.promotionRuleId); return { count: before - this.refs.length }; };
    this.promotionTriggerReference.createMany = async (args: any) => { for (const ref of args.data) this.refs.push({ id: `t${this.seq++}`, ...ref }); return { count: args.data.length }; };
    this.promotionAuditLog.create = async (args: any) => { if (this.failAudit) throw new Error("audit failed"); this.audits.push(args.data); return args.data; };
    this.promotionCompilation.findMany = async (args: any) => this.compilations.filter((c) => c.promotionRuleId === args.where.promotionRuleId).sort((a, b) => b.version - a.version);
  }
  withRefs(rule: PromotionRuleRecord | null) { return rule ? { ...rule, triggerReferences: this.refs.filter((r) => r.promotionRuleId === rule.id).sort((a, b) => a.position - b.position) } : null; }
  async $transaction<T>(fn: (tx: this) => Promise<T>) { const snapshot = JSON.stringify({ rules: this.rules, refs: this.refs, audits: this.audits }); try { return await fn(this); } catch (e) { const s = JSON.parse(snapshot); this.rules = s.rules; this.refs = s.refs; this.audits = s.audits; throw e; } }
}

async function seeded() { const db = new Db(); const rule = await createPromotionRule(base(), db as never); return { db, rule }; }

test("create rule, normalization, duplicate trigger handling, and audit creation", async () => {
  const db = new Db(); const rule = await createPromotionRule(base(), db as never);
  assert.equal(rule.name, "Sock Offer"); assert.equal(rule.offerProductGid, "gid://shopify/Product/456"); assert.equal(rule.triggerReferences?.length, 1); assert.equal(rule.triggerReferences?.[0].referenceGid, "gid://shopify/Product/123"); assert.equal(db.audits[0].action, "PROMOTION_RULE_CREATED");
});

test("read own-shop rule and reject cross-tenant read/update/archive", async () => {
  const { db, rule } = await seeded(); assert.equal((await getPromotionRuleById("shop-a", rule.id, db as never)).id, rule.id);
  await assert.rejects(() => getPromotionRuleById("shop-b", rule.id, db as never), PromotionRuleNotFoundError);
  await assert.rejects(() => updatePromotionRule("shop-b", rule.id, { name: "No" }, db as never), PromotionRuleNotFoundError);
  await assert.rejects(() => archivePromotionRule("shop-b", rule.id, {}, db as never), PromotionRuleNotFoundError);
});

test("reject invalid trigger reference, reward, and schedule", async () => {
  const db = new Db();
  await assert.rejects(() => createPromotionRule({ ...base(), triggerReferences: [{ sourceType: "COLLECTION", referenceGid: "bad" }] }, db as never), PromotionRuleValidationError);
  await assert.rejects(() => createPromotionRule({ ...base(), rewardValue: 101 }, db as never), PromotionRuleValidationError);
  await assert.rejects(() => createPromotionRule(({ ...base(), startsAt: "2026-07-12T00:00:00Z", endsAt: "2026-07-11T00:00:00Z" } as never), db as never), PromotionRuleValidationError);
});

test("replace trigger references atomically and roll back when audit creation fails", async () => {
  const { db, rule } = await seeded(); db.failAudit = true;
  await assert.rejects(() => replacePromotionTriggerReferences("shop-a", rule.id, [{ sourceType: "PRODUCT", referenceGid: "789" }], {}, db as never), /audit failed/);
  assert.equal(db.refs.filter((r) => r.promotionRuleId === rule.id)[0].referenceGid, "gid://shopify/Product/123");
  db.failAudit = false; await replacePromotionTriggerReferences("shop-a", rule.id, [{ sourceType: "PRODUCT", referenceGid: "789" }], {}, db as never);
  assert.equal(db.refs.filter((r) => r.promotionRuleId === rule.id)[0].referenceGid, "gid://shopify/Product/789"); assert.equal(db.audits.at(-1)?.action, "PROMOTION_TRIGGER_REFERENCES_REPLACED");
});

test("valid and invalid status transitions plus activation validation", async () => {
  const { db, rule } = await seeded(); await changePromotionRuleStatus("shop-a", rule.id, "ACTIVE", {}, db as never); assert.equal(db.rules[0].status, "ACTIVE");
  await changePromotionRuleStatus("shop-a", rule.id, "PAUSED", {}, db as never); await changePromotionRuleStatus("shop-a", rule.id, "ACTIVE", {}, db as never); await archivePromotionRule("shop-a", rule.id, {}, db as never);
  await assert.rejects(() => changePromotionRuleStatus("shop-a", rule.id, "ACTIVE", {}, db as never), PromotionRuleTransitionError);
  const draft = await createPromotionRule({ ...base(), triggerReferences: [] }, db as never); await assert.rejects(() => changePromotionRuleStatus("shop-a", draft.id, "ACTIVE", {}, db as never), PromotionRuleValidationError);
});


test("activates database-loaded draft rules with Decimal-like reward values", async () => {
  const { db, rule } = await seeded();
  db.rules[0].rewardValue = new DecimalLike("50");
  await changePromotionRuleStatus("shop-a", rule.id, "ACTIVE", {}, db as never);
  assert.equal(db.rules[0].status, "ACTIVE");
});

test("keeps percentage range validation for Decimal-like reward values", async () => {
  const { db, rule } = await seeded();
  db.rules[0].rewardValue = new DecimalLike("150");
  await assert.rejects(() => changePromotionRuleStatus("shop-a", rule.id, "ACTIVE", {}, db as never), PromotionRuleValidationError);
  assert.equal(db.rules[0].status, "DRAFT");
});

test("normalizes Decimal-like reward values by reward type and minimum subtotal during updates", async () => {
  const { db, rule } = await seeded();

  await updatePromotionRule("shop-a", rule.id, { rewardType: "FIXED_AMOUNT_OFF", rewardValue: new DecimalLike("100") as never, minimumCartSubtotal: new DecimalLike("12.5000") }, db as never);
  assert.equal(db.rules[0].rewardValue, 100);
  assert.equal(db.rules[0].minimumCartSubtotal, 12.5);

  await updatePromotionRule("shop-a", rule.id, { rewardType: "FIXED_PRICE", rewardValue: new DecimalLike("0") as never }, db as never);
  assert.equal(db.rules[0].rewardValue, 0);
});

test("archive behavior, archived filtering, and include-archived listing", async () => {
  const { db, rule } = await seeded(); await archivePromotionRule("shop-a", rule.id, {}, db as never);
  assert.equal(db.rules[0].status, "ARCHIVED"); assert.ok(db.rules[0].archivedAt);
  assert.equal((await listPromotionRules("shop-a", {}, db as never)).length, 0); assert.equal((await listPromotionRules("shop-a", { includeArchived: true }, db as never)).length, 1);
});

test("material updates invalidate compilation pointer while preserving compilation history scoped by tenant", async () => {
  const { db, rule } = await seeded(); db.rules[0].currentCompilationId = "c2"; db.rules[0].compiledAt = new Date();
  await updatePromotionRule("shop-a", rule.id, { name: "New" }, db as never); assert.equal(db.rules[0].currentCompilationId, null); assert.equal(db.rules[0].compiledAt, null);
  db.compilations[1].promotionRuleId = rule.id; assert.equal((await listPromotionCompilations("shop-a", rule.id, db as never))[0].id, "c2");
  await assert.rejects(() => listPromotionCompilations("shop-b", rule.id, db as never), PromotionRuleNotFoundError);
});
