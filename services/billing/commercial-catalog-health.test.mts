import test from "node:test";
import assert from "node:assert/strict";
import { __setCommercialCatalogHealthPrismaForTests, COMMERCIAL_CATALOG_NOT_CONFIGURED, requirePrimaryCommercialCatalog, verifyPrimaryCommercialCatalog } from "./commercial-catalog-health.ts";

function setPlan(plan: any) { __setCommercialCatalogHealthPrismaForTests({ pricingPlan: { async findUnique() { return plan; } } } as any); }
const feature = (code: string, active = true, featureActive = true) => ({ active, billableFeature: { code, active: featureActive } });

test("missing or inactive primary plan reports normalized catalog configuration error", async () => {
  setPlan(null); assert.equal((await verifyPrimaryCommercialCatalog()).errorCode, COMMERCIAL_CATALOG_NOT_CONFIGURED);
  await assert.rejects(() => requirePrimaryCommercialCatalog(), { name: "CommercialCatalogConfigurationError" });
  setPlan({ id: "plan", code: "PROFESSIONAL", active: false, currency: "INR", features: [feature("OTP"), feature("EMAIL")] });
  assert.equal((await verifyPrimaryCommercialCatalog()).ready, false);
});
test("missing OTP or Email pricing reports catalog configuration error", async () => {
  setPlan({ id: "plan", code: "PROFESSIONAL", active: true, currency: "INR", features: [feature("OTP")] }); assert.deepEqual((await verifyPrimaryCommercialCatalog()).missingFeatureCodes, ["EMAIL"]);
  setPlan({ id: "plan", code: "PROFESSIONAL", active: true, currency: "INR", features: [feature("EMAIL")] }); assert.deepEqual((await verifyPrimaryCommercialCatalog()).missingFeatureCodes, ["OTP"]);
});
test("complete active catalog passes verification", async () => {
  setPlan({ id: "plan", code: "PROFESSIONAL", active: true, currency: "INR", features: [feature("OTP"), feature("EMAIL"), feature("SMS")] });
  assert.deepEqual(await verifyPrimaryCommercialCatalog(), { ready: true, planCode: "PROFESSIONAL", planId: "plan", activeFeatureCodes: ["EMAIL", "OTP", "SMS"], missingFeatureCodes: [], errorCode: null });
});
