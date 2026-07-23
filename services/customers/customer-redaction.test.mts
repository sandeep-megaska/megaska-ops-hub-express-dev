import assert from "node:assert/strict";
import test from "node:test";
import { buildCustomerRedactionMatch, hasUnmatchablePhoneIdentifier } from "./customer-redaction.ts";

test("matches by shopifyCustomerId across both raw and GID-prefixed storage", () => {
  const or = buildCustomerRedactionMatch({ shopifyCustomerId: "191167" });
  assert.deepEqual(or, [{ shopifyCustomerId: { in: ["191167", "gid://shopify/Customer/191167"] } }]);
});

test("matches by email case-insensitively and normalizes whitespace/case", () => {
  const or = buildCustomerRedactionMatch({ email: "  John@Example.com " });
  assert.deepEqual(or, [{ email: { equals: "john@example.com", mode: "insensitive" } }]);
});

test("only matches phone when it is already canonical E.164", () => {
  const canonical = buildCustomerRedactionMatch({ phone: "+919539180257" });
  assert.deepEqual(canonical, [{ phoneE164: "+919539180257" }]);

  const nonCanonical = buildCustomerRedactionMatch({ phone: "555-625-1199" });
  assert.deepEqual(nonCanonical, []);
});

test("combines every provided identifier into an OR match", () => {
  const or = buildCustomerRedactionMatch({
    shopifyCustomerId: "191167",
    email: "john@example.com",
    phone: "+919539180257",
  });
  assert.equal(or.length, 3);
});

test("returns no clauses when no identifiers are provided", () => {
  assert.deepEqual(buildCustomerRedactionMatch({}), []);
  assert.deepEqual(buildCustomerRedactionMatch({ shopifyCustomerId: "", email: "", phone: "" }), []);
});

test("flags a phone identifier that could not be matched instead of guessing", () => {
  assert.equal(hasUnmatchablePhoneIdentifier({ phone: "555-625-1199" }), true);
  assert.equal(hasUnmatchablePhoneIdentifier({ phone: "+919539180257" }), false);
  assert.equal(hasUnmatchablePhoneIdentifier({}), false);
});
