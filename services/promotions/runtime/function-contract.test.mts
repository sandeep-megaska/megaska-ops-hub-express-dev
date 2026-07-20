/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../../../shared/fixtures/loopdesk-function-configuration.json" with { type: "json" };
import { assembleFunctionConfiguration, canPublishOrderRewards, isLoopDeskFunctionMetafieldNamespace } from "./function-contract.ts";
import { mapCompilationToFunctionRule } from "./mapper.ts";

test("metafield namespace helper accepts only LoopDesk app-owned identities", () => {
  for (const namespace of ["$app:loopdesk-promotions", "app--123456789--loopdesk-promotions", "app--client_id-ABC_123--loopdesk-promotions"]) {
    assert.equal(isLoopDeskFunctionMetafieldNamespace(namespace), true, namespace);
  }

  for (const namespace of [null, undefined, "", "loopdesk-promotions", "$app:another-namespace", "app--some-app--another-namespace", "app----loopdesk-promotions", "app--some-app--", "xapp--some-app--loopdesk-promotions", "app--some-app--loopdesk-promotions-extra"]) {
    assert.equal(isLoopDeskFunctionMetafieldNamespace(namespace), false, String(namespace));
  }
});

test("fixture has exact top-level keys and stable hash", () => {
  const config = assembleFunctionConfiguration({ configurationVersion: fixture.configurationVersion, rules: fixture.rules as any });
  assert.deepEqual(Object.keys(config), ["schemaVersion", "configurationVersion", "configurationHash", "rules"]);
  assert.equal(config.configurationHash, fixture.configurationHash);
});

test("rule mapper excludes compiler-only and presentation keys", () => {
  const rule = mapCompilationToFunctionRule({ id: "r1", status: "ACTIVE", priority: 2, currentCompilation: { version: 1, status: "READY", functionPayload: { ...fixture.rules[0], schedule: {}, combinesWith: {}, presentation: {}, offer: { ...fixture.rules[0].offer, title: "Title", handle: "handle", imageUrl: "https://example.test/image.jpg" } } } });
  assert.deepEqual(Object.keys(rule), ["schemaVersion", "ruleId", "compilationVersion", "status", "priority", "trigger", "offer", "reward"]);
  assert.deepEqual(Object.keys(rule.offer), ["productGid", "handle"]);
  assert.equal(rule.offer.handle, "handle");
  assert.equal("schedule" in rule, false);
  assert.equal("combinesWith" in rule, false);
});

test("compilationVersion must be positive", () => {
  assert.throws(() => mapCompilationToFunctionRule({ id: "r1", status: "ACTIVE", priority: 1, currentCompilation: { version: 0, status: "READY", functionPayload: fixture.rules[0] } }), /positive/);
});

test("deterministically sorts rules, source groups and product gids", () => {
  const messy = [{ ...fixture.rules[0], ruleId: "b", priority: 2 }, { ...fixture.rules[0], ruleId: "a", priority: 1, trigger: { ...fixture.rules[0].trigger, sourceGroups: [{ ...fixture.rules[0].trigger.sourceGroups[0], productGids: ["z", "a", "z"] }] } }] as any;
  const config = assembleFunctionConfiguration({ configurationVersion: 2, rules: messy });
  assert.deepEqual(config.rules.map((r) => r.ruleId), ["a", "b"]);
  assert.deepEqual(config.rules[0].trigger.sourceGroups[0].productGids, ["a", "z"]);
  assert.notEqual(config.configurationHash, fixture.configurationHash);
});

test("changed reward, trigger, compilation version and configuration version change hash", () => {
  const base = assembleFunctionConfiguration({ configurationVersion: 1, rules: fixture.rules as any });
  for (const rules of [ [{ ...fixture.rules[0], reward: { ...fixture.rules[0].reward, configuration: { ...fixture.rules[0].reward.configuration, value: "50" } } }], [{ ...fixture.rules[0], trigger: { ...fixture.rules[0].trigger, minimumQuantity: 2 } }], [{ ...fixture.rules[0], compilationVersion: 4 }] ] as any[]) assert.notEqual(assembleFunctionConfiguration({ configurationVersion: 1, rules }).configurationHash, base.configurationHash);
  assert.notEqual(assembleFunctionConfiguration({ configurationVersion: 2, rules: fixture.rules as any }).configurationHash, base.configurationHash);
});

test("V2 canonically serializes order tiers and hashes semantic equivalents identically", () => {
  const base = fixture.rules[0] as any;
  const order = { ...base, ruleId: "order-public", priority: 100, reward: { scope: "order", method: "percentage", configuration: { selectionMode: "highest_eligible", continuityMode: "continuous", basis: "eligible_merchandise_subtotal", tiers: [
    { id: "high", minimumSubtotal: "1000.00", percentage: "15.0" },
    { id: "low", minimumSubtotal: "0.0", maximumSubtotal: "1000.000", percentage: "10.00" },
  ] } } };
  const first = assembleFunctionConfiguration({ functionContractVersion: 2, configurationVersion: 1, rules: [order] });
  const second = assembleFunctionConfiguration({ functionContractVersion: 2, configurationVersion: 1, rules: [{ ...order, reward: { ...order.reward, configuration: { ...order.reward.configuration, tiers: [...order.reward.configuration.tiers].reverse() } } }] });
  assert.equal(first.functionContractVersion, 2);
  assert.deepEqual((first.rules[0].reward as any).configuration.tiers.map((tier: any) => tier.id), ["low", "high"]);
  assert.equal(first.configurationHash, second.configurationHash);
  assert.throws(() => assembleFunctionConfiguration({ configurationVersion: 1, rules: [order] }), /V1 cannot contain order/);
});

test("order publication gate fails closed with structured reasons", () => {
  const blocked = canPublishOrderRewards({ deployedFunctionContractVersion: 1, discountClasses: ["PRODUCT"], runtimeValidation: false, synchronizationStatus: "STALE", combinationStateVerified: false, contractHashVerified: false });
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.blockingReasons, ["order_function_contract_unsupported", "order_discount_class_missing", "order_reward_invalid", "order_runtime_not_synchronized", "order_combination_state_unverified", "order_contract_hash_unverified"]);
  assert.equal(canPublishOrderRewards({ deployedFunctionContractVersion: 2, discountClasses: ["PRODUCT", "ORDER"], runtimeValidation: true, synchronizationStatus: "SYNCED", combinationStateVerified: true, contractHashVerified: true }).allowed, true);
});
