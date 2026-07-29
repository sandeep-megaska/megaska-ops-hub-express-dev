import test from "node:test";
import assert from "node:assert/strict";

import { signInvoiceDocumentAccess, verifyInvoiceDocumentAccess } from "./invoice-url-signing.ts";

const NOW_MS = 1_800_000_000_000; // fixed clock (ms)
const DOC = "doc-123";
const SHOP = "shop-abc";

test.before(() => {
  process.env.SHOPIFY_API_SECRET = "test-shopify-api-secret";
});

test("a freshly signed URL verifies for the same document + shop", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS);
  assert.ok(signed, "signing should succeed when a secret is configured");
  const result = verifyInvoiceDocumentAccess(DOC, { shopId: SHOP, exp: signed!.exp, sig: signed!.sig }, NOW_MS);
  assert.equal(result.ok, true);
  assert.equal(result.shopId, SHOP);
});

test("a tampered signature is rejected", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS)!;
  const result = verifyInvoiceDocumentAccess(
    DOC,
    { shopId: SHOP, exp: signed.exp, sig: signed.sig.slice(0, -2) + "xy" },
    NOW_MS,
  );
  assert.equal(result.ok, false);
});

test("a signature for a different shop is rejected", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS)!;
  const result = verifyInvoiceDocumentAccess(DOC, { shopId: "other-shop", exp: signed.exp, sig: signed.sig }, NOW_MS);
  assert.equal(result.ok, false);
});

test("a signature for a different document is rejected", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS)!;
  const result = verifyInvoiceDocumentAccess("other-doc", { shopId: SHOP, exp: signed.exp, sig: signed.sig }, NOW_MS);
  assert.equal(result.ok, false);
});

test("an expired signature is rejected", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS)!;
  const later = NOW_MS + 301 * 1000; // one second past expiry
  const result = verifyInvoiceDocumentAccess(DOC, { shopId: SHOP, exp: signed.exp, sig: signed.sig }, later);
  assert.equal(result.ok, false);
});

test("missing params are rejected", () => {
  const signed = signInvoiceDocumentAccess(DOC, SHOP, 300, NOW_MS)!;
  assert.equal(verifyInvoiceDocumentAccess(DOC, { shopId: "", exp: signed.exp, sig: signed.sig }, NOW_MS).ok, false);
  assert.equal(verifyInvoiceDocumentAccess(DOC, { shopId: SHOP, exp: 0, sig: signed.sig }, NOW_MS).ok, false);
  assert.equal(verifyInvoiceDocumentAccess(DOC, { shopId: SHOP, exp: signed.exp, sig: "" }, NOW_MS).ok, false);
});
