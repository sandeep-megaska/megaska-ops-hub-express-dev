import assert from "node:assert/strict";
import test from "node:test";
import { formatNewReviewAdminNotification, sendNewReviewAdminNotification, type NewReviewAdminNotificationInput } from "./review-admin-notification.ts";

const standard: NewReviewAdminNotificationInput = {
  shopId: "shop-1", reviewId: "review-1", rating: 5, title: "Comfortable and valuable", body: "The product fits well.\r\n\r\n\r\nVery comfortable.", customerDisplayName: "Alex", productTitle: "Women's Red One Piece Swimsuit", variantTitle: "Size: S", orderName: "#1027", verifiedPurchase: true, status: "PENDING_MODERATION", submittedAt: new Date("2026-07-19T12:00:00.000Z"),
};

test("sends a GENERAL admin alert with review content and stable usage identity", async () => {
  let sent: Record<string, unknown> | undefined;
  await sendNewReviewAdminNotification(standard, { sendAdminAlert: async (input) => { sent = input; return { skipped: false, success: true, messageId: "message" }; } });
  assert.equal(sent?.shopId, "shop-1");
  assert.equal(sent?.eventType, "GENERAL");
  assert.match(String(sent?.subject), /New 5-star review for Women's Red One Piece Swimsuit/);
  const text = String(sent?.text);
  for (const expected of ["Product: Women's Red One Piece Swimsuit", "Variant: Size: S", "Rating: 5/5", "Reviewer: Alex", "Verified purchase: Yes", "Order: #1027", "Status: Pending moderation", "Comfortable and valuable", "The product fits well."]) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.deepEqual(sent?.usageContext, { sourceType: "PRODUCT_REVIEW", sourceId: "review-1", idempotencyKey: "product-review:review-1:admin-new-review", metadata: { status: "PENDING_MODERATION", rating: 5 } });
});

test("formats automatic publication and omits absent/default optional fields", () => {
  const result = formatNewReviewAdminNotification({ ...standard, status: "PUBLISHED", variantTitle: "Default Title", orderName: null, title: null, body: null });
  assert.match(result.text, /Status: Published automatically/);
  assert.doesNotMatch(result.text, /Variant:|Order:|Review title:|Review:\n|null|undefined/);
});

test("uses the fallback subject when the product title is unavailable", () => {
  assert.equal(formatNewReviewAdminNotification({ ...standard, productTitle: "\r\n" }).subject, "New customer review submitted");
});

test("contains skipped sends, provider failures, and unexpected throws", async () => {
  await assert.doesNotReject(() => sendNewReviewAdminNotification(standard, { sendAdminAlert: async () => ({ skipped: true, reason: "EMAIL_DISABLED" }) }));
  await assert.doesNotReject(() => sendNewReviewAdminNotification(standard, { sendAdminAlert: async () => ({ skipped: false, success: false, errorCode: "PROVIDER_FAILED" }) }));
  await assert.doesNotReject(() => sendNewReviewAdminNotification(standard, { sendAdminAlert: async () => { throw new Error("transport failed"); } }));
});
