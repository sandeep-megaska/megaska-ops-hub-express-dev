import assert from "node:assert/strict";
import test from "node:test";
import { fetchShopifyOrderContactEmail, normalizeRecipientEmail, resolveReviewRecipientEmail } from "./review-recipient.ts";

test("normalizes and validates recipient emails", () => {
  assert.equal(normalizeRecipientEmail("  Asha@Example.COM "), "asha@example.com");
  assert.equal(normalizeRecipientEmail("not-an-email"), null);
  assert.equal(normalizeRecipientEmail(null), null);
});

test("profile email is used without calling Shopify", async () => {
  const email = await resolveReviewRecipientEmail(
    { profileEmail: "asha@example.com", shopDomain: "shop.myshopify.com", shopifyOrderId: "gid://shopify/Order/1" },
    async () => { throw new Error("must not be called"); },
  );
  assert.equal(email, "asha@example.com");
});

test("falls back to the Shopify order contact email when the profile has none", async () => {
  const email = await resolveReviewRecipientEmail(
    { profileEmail: null, shopDomain: "shop.myshopify.com", shopifyOrderId: "gid://shopify/Order/1" },
    async (input) => { assert.equal(input.shopifyOrderId, "gid://shopify/Order/1"); return "buyer@example.com"; },
  );
  assert.equal(email, "buyer@example.com");
});

test("no order reference means no recipient, and lookup errors propagate for retry", async () => {
  assert.equal(await resolveReviewRecipientEmail({ profileEmail: "", shopDomain: "shop.myshopify.com", shopifyOrderId: null }), null);
  await assert.rejects(resolveReviewRecipientEmail(
    { profileEmail: null, shopDomain: "shop.myshopify.com", shopifyOrderId: "gid://shopify/Order/1" },
    async () => { throw new Error("shopify down"); },
  ));
});

test("order email is preferred over the customer's default email", async () => {
  const graphql = async <T,>() => ({ order: { email: "Order@Example.com", customer: { defaultEmailAddress: { emailAddress: "customer@example.com" } } } }) as T;
  assert.equal(await fetchShopifyOrderContactEmail({ shopDomain: "s", shopifyOrderId: "o" }, graphql), "order@example.com");
  const fallback = async <T,>() => ({ order: { email: null, customer: { defaultEmailAddress: { emailAddress: "customer@example.com" } } } }) as T;
  assert.equal(await fetchShopifyOrderContactEmail({ shopDomain: "s", shopifyOrderId: "o" }, fallback), "customer@example.com");
});
