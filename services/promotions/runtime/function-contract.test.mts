import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../../../shared/fixtures/loopdesk-function-configuration.json" with { type: "json" };
import { assembleFunctionConfiguration, isLoopDeskFunctionMetafieldNamespace } from "./function-contract.ts";
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
  assert.deepEqual(Object.keys(rule.offer), ["productGid"]);
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
  for (const rules of [ [{ ...fixture.rules[0], reward: { ...fixture.rules[0].reward, value: "50.00" } }], [{ ...fixture.rules[0], trigger: { ...fixture.rules[0].trigger, minimumQuantity: 2 } }], [{ ...fixture.rules[0], compilationVersion: 4 }] ] as any[]) assert.notEqual(assembleFunctionConfiguration({ configurationVersion: 1, rules }).configurationHash, base.configurationHash);
  assert.notEqual(assembleFunctionConfiguration({ configurationVersion: 2, rules: fixture.rules as any }).configurationHash, base.configurationHash);
});
