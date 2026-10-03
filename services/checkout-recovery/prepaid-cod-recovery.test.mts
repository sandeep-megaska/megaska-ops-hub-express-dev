import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCodRecoveryEmail,
  createCodRecoveryToken,
  PREPAID_COD_RECOVERY_EVENT,
  runPrepaidCodRecovery,
  selectPrepaidCodCandidates,
  verifyCodRecoveryToken,
} from "./prepaid-cod-recovery.ts";

const now = new Date("2026-10-04T10:00:00.000Z");
const SECRET = "x".repeat(40);
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function node(overrides: Record<string, unknown> = {}) {
  return {
    id: "gid://shopify/AbandonedCheckout/1",
    createdAt: minutesAgo(45),
    completedAt: null,
    abandonedCheckoutUrl: "https://megaska.com/checkouts/abc/recover",
    customAttributes: [{ key: "loopd2c_payment_intent", value: "prepaid" }, { key: "megaska_phone_verified", value: "true" }],
    customer: { firstName: "Asha", defaultEmailAddress: { emailAddress: "Asha@Example.com" }, lastOrder: null },
    lineItems: { nodes: [{ quantity: 1, variant: { id: "gid://shopify/ProductVariant/101" } }, { quantity: 2, variant: { id: "gid://shopify/ProductVariant/202" } }] },
    ...overrides,
  };
}

test("selects idle, verified, prepaid checkouts with no later order", () => {
  const [candidate] = selectPrepaidCodCandidates([node()], now);
  assert.equal(candidate.email, "asha@example.com");
  assert.equal(candidate.firstName, "Asha");
  assert.deepEqual(candidate.items, [{ variantId: 101, quantity: 1 }, { variantId: 202, quantity: 2 }]);
});

test("skips COD carts, unverified phones, too fresh or old, completed, already ordered, no email", () => {
  const skipped = [
    node({ customAttributes: [{ key: "loopd2c_payment_intent", value: "cod" }, { key: "megaska_phone_verified", value: "true" }] }),
    node({ customAttributes: [{ key: "loopd2c_payment_intent", value: "prepaid" }] }),
    node({ createdAt: minutesAgo(10) }),
    node({ createdAt: minutesAgo(60 * 25) }),
    node({ completedAt: minutesAgo(5) }),
    node({ customer: { firstName: "A", defaultEmailAddress: { emailAddress: "a@example.com" }, lastOrder: { createdAt: minutesAgo(20) } } }),
    node({ customer: { firstName: "A", defaultEmailAddress: null, lastOrder: null } }),
    node({ lineItems: { nodes: [{ quantity: 1, variant: null }] } }),
  ];
  assert.deepEqual(selectPrepaidCodCandidates(skipped, now), []);
  // An order placed before this checkout does not count as recovered.
  const older = node({ customer: { firstName: "A", defaultEmailAddress: { emailAddress: "a@example.com" }, lastOrder: { createdAt: minutesAgo(600) } } });
  assert.equal(selectPrepaidCodCandidates([older], now).length, 1);
});

test("tokens round-trip and reject tampering, other shops and expiry", () => {
  const token = createCodRecoveryToken({ shopId: "shop-1", checkoutId: "c1", items: [{ variantId: 101, quantity: 2 }], now }, SECRET);
  assert.deepEqual(verifyCodRecoveryToken(token, { shopId: "shop-1", now }, SECRET), { checkoutId: "c1", items: [{ variantId: 101, quantity: 2 }] });
  assert.equal(verifyCodRecoveryToken(token, { shopId: "shop-2", now }, SECRET), null);
  assert.equal(verifyCodRecoveryToken(token, { shopId: "shop-1", now: new Date(now.getTime() + 8 * 86_400_000) }, SECRET), null);
  assert.equal(verifyCodRecoveryToken(token, { shopId: "shop-1", now }, "y".repeat(40)), null);
  const [body, signature] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ s: "shop-1", c: "c1", i: [[999, 9]], e: now.getTime() + 1000 })).toString("base64url");
  assert.equal(verifyCodRecoveryToken(`${forged}.${signature}`, { shopId: "shop-1", now }, SECRET), null);
  assert.equal(verifyCodRecoveryToken(body, { shopId: "shop-1", now }, SECRET), null);
  assert.equal(verifyCodRecoveryToken(token, { shopId: "shop-1", now }, null), null);
});

test("email offers COD first and keeps the online link", () => {
  const email = buildCodRecoveryEmail({ shopName: "MEGASKA", firstName: "Asha", codLink: "https://megaska.com/apps/loopd2c/checkout/switch-cod?t=x", onlineLink: "https://megaska.com/checkouts/abc/recover" });
  assert.match(email.text, /^Hi Asha,/);
  assert.ok(email.text.indexOf("Cash on Delivery") < email.text.indexOf("finish paying online"));
  assert.ok(email.text.includes("switch-cod?t=x"));
});

test("run is opt-in, sends once per checkout and records only accepted sends", async () => {
  const off = await runPrepaidCodRecovery({ now }, { env: { CHECKOUT_RECOVERY_SIGNING_SECRET: SECRET } });
  assert.equal(off.enabled, false);

  const audit: Array<Record<string, unknown>> = [];
  const sent: string[] = [];
  const env = { CHECKOUT_RECOVERY_SIGNING_SECRET: SECRET, PREPAID_COD_RECOVERY_SHOPS: "megaska.myshopify.com" };
  const db = {
    shop: { findMany: async () => [{ id: "shop-1", shopDomain: "megaska.myshopify.com", primaryDomain: "megaska.com", shopName: "MEGASKA" }] },
    auditEvent: {
      findFirst: async (args: unknown) => (audit.some((row) => (row as { entityId: string }).entityId === (args as { where: { entityId: string } }).where.entityId) ? { id: "a" } : null),
      create: async (args: unknown) => { audit.push((args as { data: Record<string, unknown> }).data); },
    },
  };
  const listCheckouts = async () => [node(), node({ id: "gid://shopify/AbandonedCheckout/2" })];
  let failSecond = true;
  const sendEmail = async (input: { checkoutId: string; text: string }) => {
    if (input.checkoutId.endsWith("/2") && failSecond) return { sent: false };
    sent.push(input.checkoutId);
    assert.ok(input.text.includes("https://megaska.com/apps/loopd2c/checkout/switch-cod?t="));
    return { sent: true };
  };

  const first = await runPrepaidCodRecovery({ now }, { env, db, listCheckouts, sendEmail });
  assert.deepEqual({ sent: first.sent, failed: first.failed, alreadySent: first.alreadySent }, { sent: 1, failed: 1, alreadySent: 0 });
  assert.equal(audit.length, 1);
  assert.equal(audit[0].eventType, PREPAID_COD_RECOVERY_EVENT);

  failSecond = false;
  const second = await runPrepaidCodRecovery({ now }, { env, db, listCheckouts, sendEmail });
  assert.deepEqual({ sent: second.sent, alreadySent: second.alreadySent }, { sent: 1, alreadySent: 1 });
  assert.deepEqual(sent, ["gid://shopify/AbandonedCheckout/1", "gid://shopify/AbandonedCheckout/2"]);
});
