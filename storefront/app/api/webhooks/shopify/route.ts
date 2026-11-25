import { revalidateTag } from "next/cache";
import { env } from "@/lib/env.ts";
import { verifyShopifyWebhook } from "@/lib/shopify/webhook.ts";
import { ensureStore } from "@/lib/sync/store.ts";
import { handleWebhook } from "@/lib/sync/webhooks.ts";

export const maxDuration = 30;

// One endpoint for every catalog topic; Shopify sends the topic in a header.
export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer());
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  if (!verifyShopifyWebhook(rawBody, hmac, env.shopifyWebhookSecret())) {
    return new Response("Invalid signature", { status: 401 });
  }

  const shopDomain = request.headers.get("x-shopify-shop-domain");
  if (shopDomain && shopDomain !== env.shopifyStoreDomain()) {
    return new Response("Unknown shop", { status: 403 });
  }

  const topic = request.headers.get("x-shopify-topic") ?? "";
  const webhookId = request.headers.get("x-shopify-webhook-id") ?? request.headers.get("x-shopify-event-id");
  if (!topic || !webhookId) return new Response("Missing Shopify headers", { status: 400 });

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const storeId = await ensureStore();
    const outcome = await handleWebhook(storeId, { webhookId, topic, payload });
    // Webhooks come from outside, so expire right away instead of serving stale.
    for (const tag of outcome.tags) revalidateTag(tag, { expire: 0 });
    return Response.json({ ok: true, ...outcome });
  } catch (error) {
    console.error("[webhook] failed", { topic, webhookId, error });
    // Non-2xx makes Shopify retry the delivery (with backoff, for up to 48 hours).
    return new Response("Processing failed", { status: 500 });
  }
}
