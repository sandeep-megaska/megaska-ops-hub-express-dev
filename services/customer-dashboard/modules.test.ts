import test from "node:test";
import assert from "node:assert/strict";
import { loadDashboardModules, resetDashboardModuleDependenciesForTest, setDashboardModuleDependenciesForTest } from "./modules.ts";
const context = { shopId: "s", shopDomain: "x", customerProfileId: "c", sessionId: "ss", now: new Date() };
test("module defaults preserve live behavior", async () => { setDashboardModuleDependenciesForTest({ findMany: async () => [] }); const modules = await loadDashboardModules(context); assert.equal(modules.wallet, true); assert.equal(modules.shipmentTracking, true); assert.equal(modules.loyalty, false); resetDashboardModuleDependenciesForTest(); });
test("tenant module config overrides defaults", async () => { setDashboardModuleDependenciesForTest({ findMany: async () => [{ moduleKey: "wallet", enabled: false }, { moduleKey: "exchanges", enabled: false }] }); const modules = await loadDashboardModules(context); assert.equal(modules.wallet, false); assert.equal(modules.exchange, false); resetDashboardModuleDependenciesForTest(); });
