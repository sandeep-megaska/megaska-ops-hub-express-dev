// Review requests on WhatsApp.
//
// Plugs into the automatic review-request pipeline (review-request-processor):
// once a request is due and still eligible, a shop with "Review requests on
// WhatsApp" on gets the review_request template from its own WhatsApp number
// instead of the email. Email remains the fallback when WhatsApp cannot be
// used for this customer (no phone, opted out) and for the other lines of an
// order that already got its WhatsApp message (one message per order).
//
// The send is recorded as a WHATSAPP ProductReviewRequestDeliveryAttempt, so a
// review submitted from the link is attributed to REVIEW_REQUEST_WHATSAPP.

import { reviewRequestAttemptKey } from "./review-request-attempts.ts";

export const REVIEW_REQUEST_TEMPLATE = "review_request";

type SenderLike = { accessToken: string; phoneNumberId: string; languageCode: string };

export type ReviewWhatsAppPlan =
  | { use: false; reason: "disabled" | "no_phone" | "opted_out" | "order_already_messaged" }
  | { use: true; sender: SenderLike; phone: string };

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;
type AttemptDb = {
  productReviewRequestDeliveryAttempt: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<unknown>;
  };
};

const ORDER_PHONES_QUERY = `query ReviewOrderPhones($id: ID!) {
  order(id: $id) { id name phone customer { firstName defaultPhoneNumber { phoneNumber } } shippingAddress { firstName phone } customAttributes { key value } }
}`;

const orderGid = (id: string) => (id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`);

export async function planReviewRequestWhatsApp(
  input: { shopId: string; shopDomain: string; reviewRequestId: string; shopifyOrderId: string; profilePhone: string | null },
  deps: {
    db?: AttemptDb;
    getAccount?: (shopId: string) => Promise<{ reviewRequestsEnabled?: boolean } & Record<string, unknown> | null>;
    senderFor?: (account: never) => SenderLike | null;
    graphql?: Graphql;
    isOptedOut?: (phone: string, senderPhoneNumberId: string) => Promise<boolean>;
  } = {},
): Promise<ReviewWhatsAppPlan> {
  const senderModule = await import("../whatsapp/sender.ts");
  const account = await (deps.getAccount ?? ((shopId: string) => senderModule.getMerchantWhatsAppAccount(shopId)))(input.shopId);
  if (!account?.reviewRequestsEnabled) return { use: false, reason: "disabled" };
  const sender = (deps.senderFor ?? ((row: never) => senderModule.merchantSender(row)))(account as never);
  if (!sender) return { use: false, reason: "disabled" };

  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as AttemptDb);
  const sibling = await db.productReviewRequestDeliveryAttempt.findFirst({
    where: { shopId: input.shopId, channel: "WHATSAPP", status: { in: ["ACCEPTED", "DELIVERED"] }, reviewRequest: { shopifyOrderId: input.shopifyOrderId, id: { not: input.reviewRequestId } } },
    select: { id: true },
  });
  if (sibling) return { use: false, reason: "order_already_messaged" };

  const { normalizeWhatsAppPhone } = await import("../whatsapp/consent.ts");
  let phone = normalizeWhatsAppPhone(input.profilePhone);
  if (!phone || phone.length < 11) {
    try {
      const graphql = deps.graphql ?? (async (query, variables, options) => ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options));
      const data = await graphql<{ order?: Parameters<typeof import("../orders/whatsapp-cod-confirmation.ts").orderPhones>[0] | null }>(ORDER_PHONES_QUERY, { id: orderGid(input.shopifyOrderId) }, { shopDomain: input.shopDomain });
      const { orderPhones } = await import("../orders/whatsapp-cod-confirmation.ts");
      phone = data.order ? orderPhones(data.order)[0] ?? null : null;
    } catch (error) {
      console.warn("[REVIEW WHATSAPP] order_phone_lookup_failed", { reviewRequestId: input.reviewRequestId, error: error instanceof Error ? error.message : String(error) });
      phone = null;
    }
  }
  if (!phone) return { use: false, reason: "no_phone" };
  const isOptedOut = deps.isOptedOut ?? (async (value: string, senderId: string) => (await import("../whatsapp/consent.ts")).isWhatsAppOptedOut(value, senderId));
  if (await isOptedOut(phone, sender.phoneNumberId)) return { use: false, reason: "opted_out" };
  return { use: true, sender, phone };
}

export function reviewRequestTemplateVariables(input: { customerFirstName: string | null; productTitle: string; variantTitle: string | null; reviewUrl: string }) {
  const firstName = (input.customerFirstName || "").trim().split(/\s+/)[0] || "there";
  const product = input.variantTitle && input.variantTitle !== "Default Title" ? `${input.productTitle} (${input.variantTitle})` : input.productTitle;
  return [firstName, product.slice(0, 200), input.reviewUrl];
}

export async function sendReviewRequestWhatsApp(
  input: { shopId: string; reviewRequestId: string; plan: Extract<ReviewWhatsAppPlan, { use: true }>; variables: string[]; now: Date },
  deps: {
    db?: AttemptDb;
    sendTemplate?: (send: { sender: SenderLike; shopId: string; toPhone: string; templateName: string; languageCode: string; variables: string[] }) => Promise<{ success: boolean; messageId?: string | null; error?: string | null }>;
  } = {},
): Promise<{ success: true; messageId: string | null } | { success: false; error: string }> {
  const db = deps.db ?? ((await import("../db/prisma.ts")).prisma as unknown as AttemptDb);
  const sendTemplate = deps.sendTemplate ?? (async (send) => (await import("../whatsapp/index.ts")).sendTemplateMessage({ ...send, recoveryType: "REVIEW_REQUEST" }));
  const attemptNumber = (await db.productReviewRequestDeliveryAttempt.count({ where: { shopId: input.shopId, reviewRequestId: input.reviewRequestId, attemptType: "INITIAL" } })) + 1;
  let result: { success: boolean; messageId?: string | null; error?: string | null };
  try {
    result = await sendTemplate({ sender: input.plan.sender, shopId: input.shopId, toPhone: input.plan.phone, templateName: REVIEW_REQUEST_TEMPLATE, languageCode: input.plan.sender.languageCode, variables: input.variables });
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) };
  }
  await db.productReviewRequestDeliveryAttempt.create({
    data: {
      shopId: input.shopId,
      reviewRequestId: input.reviewRequestId,
      channel: "WHATSAPP",
      attemptType: "INITIAL",
      attemptNumber,
      status: result.success ? "ACCEPTED" : "FAILED_RETRYABLE",
      provider: "META_CLOUD_API",
      providerMessageId: result.messageId ?? null,
      idempotencyKey: `${reviewRequestAttemptKey(input.reviewRequestId, "INITIAL", attemptNumber)}:whatsapp`,
      scheduledAt: input.now,
      startedAt: input.now,
      completedAt: input.now,
      errorCode: result.success ? null : "REVIEW_WHATSAPP_PROVIDER_FAILED",
      errorMessageSafe: result.success ? null : String(result.error || "WhatsApp send failed").slice(0, 300),
    },
  }).catch((error) => console.error("[REVIEW WHATSAPP] attempt_record_failed", { reviewRequestId: input.reviewRequestId, error: error instanceof Error ? error.message : String(error) }));
  return result.success ? { success: true, messageId: result.messageId ?? null } : { success: false, error: String(result.error || "WhatsApp send failed") };
}
