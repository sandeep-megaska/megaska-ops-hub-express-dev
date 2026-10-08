/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import test from "node:test";
import { planReviewRequestWhatsApp, reviewRequestTemplateVariables, sendReviewRequestWhatsApp } from "./review-whatsapp.ts";

const sender = { accessToken: "t", phoneNumberId: "pn", languageCode: "en" };
const baseDeps = (overrides: any = {}) => ({
  getAccount: async () => ({ reviewRequestsEnabled: true }),
  senderFor: () => sender,
  db: { productReviewRequestDeliveryAttempt: { findFirst: async () => null, count: async () => 0, create: async () => undefined } },
  graphql: async () => ({ order: { shippingAddress: { phone: "+91 98765 43210" }, customAttributes: [] } }),
  isOptedOut: async () => false,
  ...overrides,
});
const input = { shopId: "s1", shopDomain: "shop.myshopify.com", reviewRequestId: "r1", shopifyOrderId: "123", profilePhone: null };

test("WhatsApp is used when switched on and the customer has a reachable number", async () => {
  const plan = await planReviewRequestWhatsApp({ ...input, profilePhone: "+919000000001" }, baseDeps({ graphql: async () => { throw new Error("not needed"); } }) as any);
  assert.deepEqual(plan, { use: true, sender, phone: "919000000001" });
  const fromOrder = await planReviewRequestWhatsApp(input, baseDeps() as any);
  assert.equal(fromOrder.use && fromOrder.phone, "919876543210", "falls back to the order's phone");
});

test("email stays in charge when WhatsApp is off, unreachable, opted out or the order already got its message", async () => {
  assert.deepEqual(await planReviewRequestWhatsApp(input, baseDeps({ getAccount: async () => ({ reviewRequestsEnabled: false }) }) as any), { use: false, reason: "disabled" });
  assert.deepEqual(await planReviewRequestWhatsApp(input, baseDeps({ graphql: async () => ({ order: { customAttributes: [] } }) }) as any), { use: false, reason: "no_phone" });
  assert.deepEqual(await planReviewRequestWhatsApp(input, baseDeps({ isOptedOut: async () => true }) as any), { use: false, reason: "opted_out" });
  assert.deepEqual(await planReviewRequestWhatsApp(input, baseDeps({ db: { productReviewRequestDeliveryAttempt: { findFirst: async () => ({ id: "a" }) } } }) as any), { use: false, reason: "order_already_messaged" });
});

test("template gets first name, product with size, and the review link", () => {
  assert.deepEqual(reviewRequestTemplateVariables({ customerFirstName: "Asha Rao", productTitle: "Frock Swim Dress", variantTitle: "XL / Black", reviewUrl: "https://megaska.com/apps/loopd2c/customer/reviews/write?token=abc" }), ["Asha", "Frock Swim Dress (XL / Black)", "https://megaska.com/apps/loopd2c/customer/reviews/write?token=abc"]);
  assert.equal(reviewRequestTemplateVariables({ customerFirstName: null, productTitle: "Cap", variantTitle: "Default Title", reviewUrl: "u" })[1], "Cap");
});

test("each send is recorded as a WHATSAPP attempt so the review is attributed to it", async () => {
  const created: any[] = [];
  const db = { productReviewRequestDeliveryAttempt: { findFirst: async () => null, count: async () => 1, create: async (args: any) => { created.push(args.data); } } };
  const ok = await sendReviewRequestWhatsApp({ shopId: "s1", reviewRequestId: "r1", plan: { use: true, sender, phone: "919876543210" }, variables: ["Asha", "Dress", "u"], now: new Date("2026-10-08T05:00:00Z") }, { db: db as any, sendTemplate: async (send) => { assert.equal(send.templateName, "review_request"); return { success: true, messageId: "wamid.1" }; } });
  assert.deepEqual(ok, { success: true, messageId: "wamid.1" });
  assert.equal(created[0].channel, "WHATSAPP");
  assert.equal(created[0].status, "ACCEPTED");
  assert.equal(created[0].attemptNumber, 2);
  assert.equal(created[0].idempotencyKey, "review-request:r1:initial:2:whatsapp");
  const failed = await sendReviewRequestWhatsApp({ shopId: "s1", reviewRequestId: "r1", plan: { use: true, sender, phone: "919876543210" }, variables: [], now: new Date() }, { db: db as any, sendTemplate: async () => ({ success: false, error: "template not approved" }) });
  assert.equal(failed.success, false);
  assert.equal(created[1].status, "FAILED_RETRYABLE");
});
