import assert from "node:assert/strict";
import test from "node:test";
import { fillOnlyEnrichment, groupCandidates, reconciliationChecksum, reviewCollisionKeys, selectCanonicalProfile, trustedConflicts } from "./customer-identity-reconciliation.ts";

const profile = (id: string, values: Record<string, unknown> = {}) => ({ id, shopId: "shop", shopifyCustomerId: null, phoneE164: null, phoneVerifiedAt: null, email: null, createdAt: new Date(`2020-01-0${id}T00:00:00Z`), updatedAt: new Date(0), ...values });

test("groups only trusted normalized identifiers", () => {
  const groups = groupCandidates([profile("1", { shopifyCustomerId: "123" }), profile("2", { shopifyCustomerId: "gid://shopify/Customer/123" }), profile("3", { phoneE164: "+91999" })]);
  assert.deepEqual(groups.map((g) => g.map((p) => p.id)), [["1", "2"]]);
});

test("canonical selection is deterministic and prioritizes an active session", () => {
  const selected = selectCanonicalProfile([profile("1", { shopifyCustomerId: "123" }), profile("2", { activeSessionCount: 1, phoneE164: "+91999", phoneVerifiedAt: new Date() })]);
  assert.equal(selected.canonical.id, "2"); assert.equal(selected.reason, "CURRENT_AUTH_SESSION");
});

test("trusted conflicts block and enrichment is fill-only", () => {
  const canonical = profile("1", { phoneE164: "+911", phoneVerifiedAt: new Date() });
  const duplicate = profile("2", { phoneE164: "+912", phoneVerifiedAt: new Date(), shopifyCustomerId: "42" });
  assert.deepEqual(trustedConflicts([canonical, duplicate]), ["CONFLICTING_VERIFIED_PHONES"]);
  assert.deepEqual(fillOnlyEnrichment(canonical, [duplicate]), { shopifyCustomerId: "42" });
});

test("checksum is deterministic and detects source changes", () => {
  assert.equal(reconciliationChecksum({ b: 2, a: 1 }), reconciliationChecksum({ a: 1, b: 2 }));
  assert.notEqual(reconciliationChecksum({ a: 1 }), reconciliationChecksum({ a: 2 }));
});

test("review collision preview applies the target owner before comparing business keys", () => {
  const rows = [
    { id: "source-review", shopId: "shop", customerProfileId: "source", shopifyLineItemId: "line-1" },
    { id: "target-review", shopId: "shop", customerProfileId: "target", shopifyLineItemId: "line-1" },
  ];
  assert.deepEqual(reviewCollisionKeys(rows, ["source"], "target"), [{ key: "shop:target:line-1", recordIds: ["source-review", "target-review"] }]);
  assert.deepEqual(reviewCollisionKeys(rows.slice(0, 1), ["source"], "target"), []);
});
