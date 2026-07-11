import test from "node:test";
import assert from "node:assert/strict";
import { getPromotionAdminListReadModel, toPromotionAdminListItem } from "./admin-read-model.server.ts";
import type { PromotionRuleRecord } from "./repository.server.ts";

const now = new Date("2026-07-11T10:00:00Z");
function rule(partial: Partial<PromotionRuleRecord> = {}): PromotionRuleRecord {
  return { id: partial.id ?? "r1", shopId: partial.shopId ?? "shop-a", name: partial.name ?? "Buy Socks", status: partial.status ?? "DRAFT", priority: partial.priority ?? 10, triggerType: partial.triggerType ?? "PRODUCT", triggerMatchMode: "ANY", minimumTriggerQuantity: 1, offerProductGid: partial.offerProductGid ?? "gid://shopify/Product/2", offerProductTitle: partial.offerProductTitle, rewardType: partial.rewardType ?? "PERCENTAGE_OFF", rewardValue: partial.rewardValue ?? 10, maximumRewardQuantity: 1, startsAt: partial.startsAt ?? null, endsAt: partial.endsAt ?? null, currentCompilationId: partial.currentCompilationId ?? null, compiledAt: null, archivedAt: partial.archivedAt ?? null, createdAt: now, updatedAt: partial.updatedAt ?? now, triggerReferences: [], };
}
class Db {
  rules = [rule({ id: "a", shopId: "shop-a", status: "DRAFT" }), rule({ id: "b", shopId: "shop-a", status: "ACTIVE", offerProductTitle: "Gift Mug", currentCompilationId: "c1" }), rule({ id: "c", shopId: "shop-a", status: "ARCHIVED", archivedAt: now }), rule({ id: "d", shopId: "shop-b", status: "DRAFT" })];
  promotionRule = { findMany: async (args: any) => this.rules.filter((r) => r.shopId === args.where.shopId && (args.where.status?.not ? r.status !== args.where.status.not : true) && ("archivedAt" in args.where ? (r.archivedAt ?? null) === args.where.archivedAt : true)), findFirst: async () => null, create: async () => { throw new Error("unused"); }, update: async () => { throw new Error("unused"); } };
  promotionTriggerReference = { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 0 }) };
  promotionAuditLog = { create: async () => ({}) };
  promotionCompilation = { findMany: async () => [] };
  async $transaction<T>(fn: (tx: this) => Promise<T>) { return fn(this); }
}

test("tenant-scoped admin list read model excludes archived by default", async () => {
  const items = await getPromotionAdminListReadModel("shop-a", {}, new Db() as never);
  assert.deepEqual(items.map((i) => i.id), ["a", "b"]);
  assert.ok(items.every((i) => i.status !== "ARCHIVED"));
});

test("admin list supports status filtering and explicit archived filter", async () => {
  const db = new Db();
  assert.deepEqual((await getPromotionAdminListReadModel("shop-a", { status: "ACTIVE" }, db as never)).map((i) => i.id), ["b"]);
  assert.deepEqual((await getPromotionAdminListReadModel("shop-a", { status: "ARCHIVED" }, db as never)).map((i) => i.id), ["c"]);
});

test("admin read model formats safe fallbacks and neutral execution labels", () => {
  const fallback = toPromotionAdminListItem(rule({ name: "", offerProductTitle: null, rewardType: "FIXED_PRICE", rewardValue: 99 }));
  assert.equal(fallback.name, "Untitled promotion");
  assert.equal(fallback.offerProductTitle, "gid://shopify/Product/2");
  assert.equal(fallback.rewardLabel, "Fixed price ₹99");
  assert.equal(fallback.executionLabel, "Not compiled");
  const pending = toPromotionAdminListItem(rule({ currentCompilationId: "compiled-ish" }));
  assert.equal(pending.executionLabel, "Not compiled");
  assert.notEqual(pending.executionLabel, "Published");
  assert.notEqual(pending.executionLabel, "Live");
});
