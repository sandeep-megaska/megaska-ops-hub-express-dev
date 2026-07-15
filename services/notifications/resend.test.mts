import test from "node:test";
import assert from "node:assert/strict";
import { sendAdminAlert, sendCustomerEmail, formatPlatformFrom } from "./resend.ts";
import { saveMerchantNotificationSettings, type NotificationSettingsDb } from "../settings/merchant-notifications.ts";

type Shop = { id: string; shopDomain: string; shopName: string | null };
type Saved = Awaited<ReturnType<typeof saveMerchantNotificationSettings>> & { id: string };
type MockDb = NotificationSettingsDb & { settings: Map<string, Saved> };

function db(): MockDb {
  const shops = new Map<string, Shop>([
    ["shop-a", { id: "shop-a", shopDomain: "a.myshopify.com", shopName: "Shop A" }],
    ["shop-b", { id: "shop-b", shopDomain: "b.myshopify.com", shopName: "Shop B" }],
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

const base = {
  emailEnabled: true,
  customerEmailsEnabled: true,
  senderDisplayName: "",
  replyToEmail: "",
  adminRecipients: "ops@example.com",
  cancellationAlerts: true,
  exchangeAlerts: true,
  issueAlerts: true,
  storeCreditAlerts: true,
  checkoutAlerts: true,
};

function withEnv(values: Record<string, string | undefined>) {
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function fetchOk(calls: unknown[]) {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body || "{}")));
    return { ok: true, status: 200, json: async () => ({ id: "msg_123" }) } as Response;
  }) as typeof fetch;
}

test("routes Shop A and Shop B only to their own recipients", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, adminRecipients: "a@example.com" }, client);
  await saveMerchantNotificationSettings("shop-b", { ...base, adminRecipients: "b@example.com" }, client);
  const calls: Array<Record<string, unknown>> = [];
  await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "A", text: "body" }, { db: client, fetchImpl: fetchOk(calls) });
  await sendAdminAlert({ shopId: "shop-b", eventType: "GENERAL", subject: "B", text: "body" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.deepEqual(calls.map((call) => call.to), [["a@example.com"], ["b@example.com"]]);
});

test("emailEnabled false skips all alerts", async () => {
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, emailEnabled: false }, client);
  const result = await sendAdminAlert({ shopId: "shop-a", eventType: "ISSUE", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk([]) });
  assert.deepEqual(result, { skipped: true, reason: "EMAIL_DISABLED" });
});

test("event preferences disable only mapped categories", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, cancellationAlerts: false, issueAlerts: false, exchangeAlerts: false }, client);
  { const r = await sendAdminAlert({ shopId: "shop-a", eventType: "CANCELLATION", subject: "S", text: "T" }, { db: client }); assert.equal(r.skipped && r.reason, "EVENT_DISABLED"); }
  { const r = await sendAdminAlert({ shopId: "shop-a", eventType: "ISSUE", subject: "S", text: "T" }, { db: client }); assert.equal(r.skipped && r.reason, "EVENT_DISABLED"); }
  { const r = await sendAdminAlert({ shopId: "shop-a", eventType: "EXCHANGE", subject: "S", text: "T" }, { db: client }); assert.equal(r.skipped && r.reason, "EVENT_DISABLED"); }
  const calls: Array<Record<string, unknown>> = [];
  const result = await sendAdminAlert({ shopId: "shop-a", eventType: "CHECKOUT", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.equal(result.skipped, false);
  assert.deepEqual(calls[0].to, ["ops@example.com"]);
});

test("existing settings row with empty recipients does not use legacy fallback", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com", ADMIN_ALERT_EMAIL: "legacy@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, adminRecipients: "" }, client);
  const calls: Array<Record<string, unknown>> = [];
  const result = await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.deepEqual(result, { skipped: true, reason: "NO_RECIPIENTS" });
  assert.equal(calls.length, 0);
});

test("missing settings row may use legacy global recipients", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com", ADMIN_ALERT_EMAIL: "legacy@example.com" });
  const calls: Array<Record<string, unknown>> = [];
  const result = await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: db(), fetchImpl: fetchOk(calls) });
  restore();
  assert.equal(result.skipped, false);
  assert.deepEqual(calls[0].to, ["legacy@example.com"]);
});

test("duplicate merchant recipients remain normalized", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, adminRecipients: "A@Example.com, a@example.com" }, client);
  const calls: Array<Record<string, unknown>> = [];
  await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.deepEqual(calls[0].to, ["a@example.com"]);
});

test("missing platform config skips safely", async () => {
  const restore = withEnv({ RESEND_API_KEY: undefined, OPS_NOTIFICATION_FROM_EMAIL: undefined });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", base, client);
  const result = await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client });
  restore();
  assert.deepEqual(result, { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" });
});

test("reply-to is included only when configured and display name does not change sender email", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, senderDisplayName: "Demo Store", replyToEmail: "merchant@example.com" }, client);
  await saveMerchantNotificationSettings("shop-b", { ...base, adminRecipients: "b@example.com" }, client);
  const calls: Array<Record<string, unknown>> = [];
  await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  await sendAdminAlert({ shopId: "shop-b", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.equal(calls[0].from, "Demo Store <notifications@example.com>");
  assert.equal(calls[0].reply_to, "merchant@example.com");
  assert.equal(calls[1].reply_to, undefined);
  assert.match(formatPlatformFrom("bad\r\nName <x@y.com>", "notifications@example.com"), /<notifications@example\.com>$/);
});

test("provider failure returns failure and success returns message id", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", OPS_NOTIFICATION_FROM_EMAIL: "notifications@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", base, client);
  const failFetch = (async () => ({ ok: false, status: 500, json: async () => ({ message: "nope" }) } as Response)) as typeof fetch;
  assert.deepEqual(await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: failFetch }), { skipped: false, success: false, errorCode: "PROVIDER_FAILED" });
  const ok = await sendAdminAlert({ shopId: "shop-a", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk([]) });
  restore();
  assert.deepEqual(ok, { skipped: false, success: true, messageId: "msg_123" });
});

test("unresolved shop cannot send", async () => {
  const result = await sendAdminAlert({ shopId: "missing", eventType: "GENERAL", subject: "S", text: "T" }, { db: db(), fetchImpl: fetchOk([]) });
  assert.deepEqual(result, { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" });
});

test("customer emails route by shop display name and remain tenant isolated", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", CUSTOMER_NOTIFICATION_FROM_EMAIL: "customers@example.com", OPS_NOTIFICATION_FROM_EMAIL: "ops@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, senderDisplayName: "Alpha Store", replyToEmail: "alpha@example.com" }, client);
  await saveMerchantNotificationSettings("shop-b", { ...base, senderDisplayName: "Beta Store", replyToEmail: "" }, client);
  const calls: Array<Record<string, unknown>> = [];
  await sendCustomerEmail({ shopId: "shop-a", to: " customer-a@example.com ", eventType: "EXCHANGE", subject: "A", text: "body" }, { db: client, fetchImpl: fetchOk(calls) });
  await sendCustomerEmail({ shopId: "shop-b", to: "customer-b@example.com", eventType: "STORE_CREDIT", subject: "B", text: "body" }, { db: client, fetchImpl: fetchOk(calls) });
  restore();
  assert.equal(calls[0].from, "Alpha Store <customers@example.com>");
  assert.deepEqual(calls[0].to, ["customer-a@example.com"]);
  assert.equal(calls[0].reply_to, "alpha@example.com");
  assert.equal(calls[1].from, "Beta Store <customers@example.com>");
  assert.deepEqual(calls[1].to, ["customer-b@example.com"]);
  assert.equal(calls[1].reply_to, undefined);
});

test("customer emails honor global and customer-specific disable switches", async () => {
  const client = db();
  await saveMerchantNotificationSettings("shop-a", { ...base, emailEnabled: false }, client);
  await saveMerchantNotificationSettings("shop-b", { ...base, customerEmailsEnabled: false }, client);
  assert.deepEqual(await sendCustomerEmail({ shopId: "shop-a", to: "a@example.com", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk([]) }), { skipped: true, reason: "EMAIL_DISABLED" });
  assert.deepEqual(await sendCustomerEmail({ shopId: "shop-b", to: "b@example.com", eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk([]) }), { skipped: true, reason: "CUSTOMER_EMAIL_DISABLED" });
});

test("customer emails use safe defaults when settings row is missing", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", CUSTOMER_NOTIFICATION_FROM_EMAIL: undefined, OPS_NOTIFICATION_FROM_EMAIL: "fallback@example.com" });
  const calls: Array<Record<string, unknown>> = [];
  const result = await sendCustomerEmail({ shopId: "shop-a", to: "a@example.com", eventType: "GENERAL", subject: "S", text: "T" }, { db: db(), fetchImpl: fetchOk(calls) });
  restore();
  assert.deepEqual(result, { skipped: false, success: true, messageId: "msg_123" });
  assert.equal(calls[0].from, "Shop A <fallback@example.com>");
});

test("customer recipient validation rejects missing invalid and multiple recipients", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", CUSTOMER_NOTIFICATION_FROM_EMAIL: "customers@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", base, client);
  const calls: Array<Record<string, unknown>> = [];
  for (const to of ["", "not-an-email", "a@example.com,b@example.com", "a@example.com\r\nBcc: b@example.com", `${"a".repeat(245)}@example.com`]) {
    const result = await sendCustomerEmail({ shopId: "shop-a", to, eventType: "GENERAL", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
    assert.deepEqual(result, { skipped: true, reason: "NO_RECIPIENT" });
  }
  restore();
  assert.equal(calls.length, 0);
});

test("customer email skips missing platform transport and unresolved shop", async () => {
  const restore = withEnv({ RESEND_API_KEY: undefined, CUSTOMER_NOTIFICATION_FROM_EMAIL: undefined, OPS_NOTIFICATION_FROM_EMAIL: undefined });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", base, client);
  assert.deepEqual(await sendCustomerEmail({ shopId: "shop-a", to: "a@example.com", eventType: "GENERAL", subject: "S", text: "T" }, { db: client }), { skipped: true, reason: "PLATFORM_TRANSPORT_NOT_CONFIGURED" });
  assert.deepEqual(await sendCustomerEmail({ shopId: "missing", to: "a@example.com", eventType: "GENERAL", subject: "S", text: "T" }, { db: client }), { skipped: false, success: false, errorCode: "SHOP_UNRESOLVED" });
  restore();
});

test("customer email sender cannot alter platform sender and provider outcomes are structured", async () => {
  const restore = withEnv({ RESEND_API_KEY: "key", CUSTOMER_NOTIFICATION_FROM_EMAIL: "customers@example.com" });
  const client = db();
  await saveMerchantNotificationSettings("shop-a", base, client);
  client.settings.set("shop-a", { ...client.settings.get("shop-a")!, senderDisplayName: "Bad <spoof@example.com>Name" });
  const calls: Array<Record<string, unknown>> = [];
  const ok = await sendCustomerEmail({ shopId: "shop-a", to: "a@example.com", eventType: "ORDER", subject: "S", text: "T" }, { db: client, fetchImpl: fetchOk(calls) });
  const failFetch = (async () => ({ ok: false, status: 500, json: async () => ({ message: "nope" }) } as Response)) as typeof fetch;
  const fail = await sendCustomerEmail({ shopId: "shop-a", to: "a@example.com", eventType: "ORDER", subject: "S", text: "T" }, { db: client, fetchImpl: failFetch });
  restore();
  assert.deepEqual(ok, { skipped: false, success: true, messageId: "msg_123" });
  assert.match(String(calls[0].from), /<customers@example\.com>$/);
  assert.equal(String(calls[0].from).includes("spoof@example.com>"), false);
  assert.deepEqual(fail, { skipped: false, success: false, errorCode: "PROVIDER_FAILED" });
});
