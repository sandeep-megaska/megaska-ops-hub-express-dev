import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCartDrawerModules } from "./normalize";

test("missing and empty registries normalize safely", () => {
  assert.deepEqual(normalizeCartDrawerModules(undefined), { schemaVersion: 1, modules: [] });
  assert.deepEqual(normalizeCartDrawerModules({ modules: [] }), { schemaVersion: 1, modules: [] });
});

test("unknown module keys and slots are ignored", () => {
  const modules = normalizeCartDrawerModules({ modules: [
    { key: "UNKNOWN", enabled: true, slot: "BEFORE_TOTALS", sortOrder: 1 },
    { key: "LOYALTY", enabled: true, slot: "SOMEWHERE", sortOrder: 2 },
  ] }).modules;
  assert.deepEqual(modules, []);
});

test("invalid order and malformed settings fall back without throwing", () => {
  const [module] = normalizeCartDrawerModules({ modules: [
    { key: "LOYALTY", enabled: true, slot: "BEFORE_TOTALS", sortOrder: "bad", settings: [] },
  ] }).modules;
  assert.equal(module.sortOrder, 100);
  assert.equal(module.settings, undefined);
});

test("duplicate keys keep the first valid occurrence deterministically", () => {
  const modules = normalizeCartDrawerModules({ modules: [
    { key: "LOYALTY", enabled: false, slot: "BEFORE_TOTALS", sortOrder: 20 },
    { key: "LOYALTY", enabled: true, slot: "AFTER_TOTALS", sortOrder: 1 },
  ] }).modules;
  assert.equal(modules.length, 1);
  assert.deepEqual(modules[0], { key: "LOYALTY", enabled: false, slot: "BEFORE_TOTALS", sortOrder: 20 });
});
