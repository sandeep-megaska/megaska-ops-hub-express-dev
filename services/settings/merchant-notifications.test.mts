import test from "node:test";
import assert from "node:assert/strict";
import { getMerchantNotificationSettings, saveMerchantNotificationSettings, MerchantNotificationSettingsValidationError, type NotificationSettingsDb } from "./merchant-notifications.ts";

type Shop = { id: string; shopDomain: string; shopName: string | null };
type Saved = Awaited<ReturnType<typeof saveMerchantNotificationSettings>> & { id: string };
type MockDb = NotificationSettingsDb & { settings: Map<string, Saved> };

function db(): MockDb {
  const shops = new Map<string, Shop>([
    ["shop-1", { id: "shop-1", shopDomain: "one.myshopify.com", shopName: "One Shop" }],
    ["shop-2", { id: "shop-2", shopDomain: "two.myshopify.com", shopName: "Two Shop" }],
  ]);
  const settings = new Map<string, Saved>();
  return {
    settings,
    shop: { findUnique: async ({ where }) => shops.get(where.id) || null },
    merchantNotificationSettings: {
      findUnique: async ({ where }) => settings.get(where.shopId) || null,
      upsert: async ({ where, create, update }) => {
        const next = settings.has(where.shopId) ? { ...settings.get(where.shopId)!, ...update } : { id: `mns-${where.shopId}`, ...create };
        settings.set(where.shopId, next);
        return next;
      },
    },
  };
}

const valid = { emailEnabled: true, customerEmailsEnabled: false, senderDisplayName: "", replyToEmail: "", adminRecipients: " Admin@Example.com\nadmin@example.com, ops@example.com ", cancellationAlerts: false, exchangeAlerts: true, issueAlerts: false, storeCreditAlerts: true, checkoutAlerts: false };

test("missing settings row returns defaults", async () => {
  const got = await getMerchantNotificationSettings("shop-1", db());
  assert.equal(got.senderDisplayName, "One Shop");
  assert.deepEqual(got.adminRecipients, []);
  assert.equal(got.emailEnabled, true);
});

test("settings resolve only for requested shop", async () => {
  const client = db();
  await saveMerchantNotificationSettings("shop-1", { ...valid, adminRecipients: "one@example.com" }, client);
  await saveMerchantNotificationSettings("shop-2", { ...valid, adminRecipients: "two@example.com" }, client);
  assert.deepEqual((await getMerchantNotificationSettings("shop-1", client)).adminRecipients, ["one@example.com"]);
});

test("recipient whitespace and case-insensitive duplicates are normalized", async () => {
  const got = await saveMerchantNotificationSettings("shop-1", valid, db());
  assert.deepEqual(got.adminRecipients, ["admin@example.com", "ops@example.com"]);
});

test("invalid recipient is rejected", async () => {
  await assert.rejects(() => saveMerchantNotificationSettings("shop-1", { ...valid, adminRecipients: "bad" }, db()), MerchantNotificationSettingsValidationError);
});

test("more than maximum recipient count is rejected", async () => {
  const recipients = Array.from({ length: 11 }, (_, i) => `a${i}@example.com`).join(",");
  await assert.rejects(() => saveMerchantNotificationSettings("shop-1", { ...valid, adminRecipients: recipients }, db()), /up to 10/);
});

test("invalid reply-to email is rejected", async () => {
  await assert.rejects(() => saveMerchantNotificationSettings("shop-1", { ...valid, replyToEmail: "bad" }, db()), /Reply-to/);
});

test("empty optional sender name resolves as null", async () => {
  const got = await saveMerchantNotificationSettings("shop-1", valid, db());
  assert.equal(got.senderDisplayName, null);
});

test("boolean preferences persist correctly", async () => {
  const got = await saveMerchantNotificationSettings("shop-1", valid, db());
  assert.equal(got.customerEmailsEnabled, false);
  assert.equal(got.cancellationAlerts, false);
  assert.equal(got.exchangeAlerts, true);
  assert.equal(got.checkoutAlerts, false);
});

test("one shop cannot update another shop settings through requested shop id", async () => {
  const client = db();
  await saveMerchantNotificationSettings("shop-1", { ...valid, adminRecipients: "one@example.com" }, client);
  await saveMerchantNotificationSettings("shop-2", { ...valid, adminRecipients: "two@example.com" }, client);
  assert.deepEqual(client.settings.get("shop-1")?.adminRecipients, ["one@example.com"]);
});
