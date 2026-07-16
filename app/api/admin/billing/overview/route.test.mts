import test from "node:test";
import assert from "node:assert/strict";
import { CommercialCatalogConfigurationError } from "../../../../../services/billing/commercial-catalog-health.ts";
import { billingOverviewErrorResponse } from "../../../../../services/billing/overview-errors.ts";

test("overview maps missing commercial catalog to a merchant-safe 503", () => {
  const response = billingOverviewErrorResponse(new CommercialCatalogConfigurationError({ ready: false, planCode: "PROFESSIONAL", planId: null, activeFeatureCodes: [], missingFeatureCodes: ["OTP", "EMAIL"], errorCode: "COMMERCIAL_CATALOG_NOT_CONFIGURED" }));
  assert.equal(response.status, 503); assert.equal(response.body.error, "COMMERCIAL_CATALOG_NOT_CONFIGURED");
});
test("overview maps unexpected failures to 500", () => { assert.equal(billingOverviewErrorResponse(new Error("database connection details")).status, 500); });
