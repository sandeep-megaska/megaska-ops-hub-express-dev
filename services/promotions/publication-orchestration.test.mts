import assert from "node:assert/strict";
import test from "node:test";
import { manuallySynchronizePromotionConfiguration } from "./publication-orchestration.server.ts";

test("manual synchronization freshly recompiles every publishable rule before one shop sync", async () => {
  const events: string[] = [];
  const result = await manuallySynchronizePromotionConfiguration("shop-1", "test.myshopify.com", {
    ruleReader: { findMany: async () => [{ id: "product" }, { id: "order" }] },
    compiler: (async (input: { promotionRuleId: string; reason: string }) => { events.push(`compile:${input.promotionRuleId}:${input.reason}`); return { status: "READY" }; }) as never,
    synchronizer: (async () => { events.push("sync"); return { ok: true, outcome: "UPDATED", automaticDiscountId: "discount", configurationVersion: 2, configurationHash: "hash", ruleCount: 2, verifiedAt: new Date(0).toISOString() }; }) as never,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(events, ["compile:product:MANUAL_RECOMPILE", "compile:order:MANUAL_RECOMPILE", "sync"]);
});
