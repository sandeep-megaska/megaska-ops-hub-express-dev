import { sendAdminAlert, type SendResult } from "../notifications/resend.ts";

export type NewReviewAdminNotificationInput = {
  shopId: string;
  reviewId: string;
  rating: number;
  title: string | null;
  body: string | null;
  customerDisplayName: string;
  productTitle: string;
  variantTitle: string | null;
  orderName: string | null;
  verifiedPurchase: boolean;
  status: "PENDING_MODERATION" | "PUBLISHED";
  submittedAt: Date;
};

type Dependencies = { sendAdminAlert?: typeof sendAdminAlert };

function clean(value: string | null | undefined) {
  return String(value ?? "").replace(/\r\n?/g, "\n").replace(/[\t\f\v]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function oneLine(value: string | null | undefined) {
  return clean(value).replace(/\n+/g, " ").replace(/ {2,}/g, " ");
}

function submittedDate(value: Date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(value);
}

export function formatNewReviewAdminNotification(input: NewReviewAdminNotificationInput) {
  const productTitle = oneLine(input.productTitle);
  const variantTitle = oneLine(input.variantTitle);
  const orderName = oneLine(input.orderName);
  const reviewer = oneLine(input.customerDisplayName) || "Customer";
  const title = clean(input.title);
  const body = clean(input.body);
  const subject = productTitle ? `New ${input.rating}-star review for ${productTitle}` : "New customer review submitted";
  const details = [
    productTitle ? `Product: ${productTitle}` : null,
    variantTitle && variantTitle.toLowerCase() !== "default title" ? `Variant: ${variantTitle}` : null,
    `Rating: ${input.rating}/5`,
    `Reviewer: ${reviewer}`,
    `Verified purchase: ${input.verifiedPurchase ? "Yes" : "No"}`,
    orderName ? `Order: ${orderName}` : null,
    `Status: ${input.status === "PUBLISHED" ? "Published automatically" : "Pending moderation"}`,
    `Submitted: ${submittedDate(input.submittedAt)}`,
  ].filter((line): line is string => Boolean(line));
  const sections = ["A new customer review has been submitted.", details.join("\n")];
  if (title) sections.push(`Review title:\n${title}`);
  if (body) sections.push(`Review:\n${body}`);
  sections.push("Open the LoopD2C admin dashboard to review or moderate this submission.");
  return { subject, text: sections.join("\n\n") };
}

export async function sendNewReviewAdminNotification(input: NewReviewAdminNotificationInput, dependencies: Dependencies = {}): Promise<void> {
  const send = dependencies.sendAdminAlert ?? sendAdminAlert;
  console.info("[REVIEWS]", { operation: "admin_submission_notification_attempted", shopId: input.shopId, reviewId: input.reviewId, status: input.status, rating: input.rating });
  try {
    const content = formatNewReviewAdminNotification(input);
    const result: SendResult = await send({
      shopId: input.shopId,
      eventType: "GENERAL",
      subject: content.subject,
      text: content.text,
      usageContext: {
        sourceType: "PRODUCT_REVIEW",
        sourceId: input.reviewId,
        idempotencyKey: `product-review:${input.reviewId}:admin-new-review`,
        metadata: { status: input.status, rating: input.rating },
      },
    });
    if (result.skipped) console.info("[REVIEWS]", { operation: "admin_submission_notification_skipped", shopId: input.shopId, reviewId: input.reviewId, status: input.status, rating: input.rating, reason: result.reason });
    else if (result.success) console.info("[REVIEWS]", { operation: "admin_submission_notification_sent", shopId: input.shopId, reviewId: input.reviewId, status: input.status, rating: input.rating });
    else console.error("[REVIEWS]", { operation: "admin_submission_notification_failed", shopId: input.shopId, reviewId: input.reviewId, status: input.status, rating: input.rating, errorCode: result.errorCode ?? null });
  } catch (error) {
    console.error("[REVIEWS]", { operation: "admin_submission_notification_failed", reviewId: input.reviewId, shopId: input.shopId, errorName: error instanceof Error ? error.name : null });
  }
}
