// Subscribe the deployed storefront to Shopify catalog webhooks. Usage:
//   node --env-file=.env.local --experimental-strip-types scripts/register-webhooks.ts https://<your-app>.vercel.app
// Safe to rerun: topics already pointing at this URL are skipped.
import { adminGraphql } from "../lib/shopify/admin.ts";
import { WEBHOOK_SUBSCRIPTION_CREATE, WEBHOOK_SUBSCRIPTIONS_QUERY } from "../lib/shopify/queries.ts";
import { SYNC_WEBHOOK_TOPICS } from "../lib/shopify/webhook.ts";
import type { Connection } from "../lib/shopify/types.ts";

const base = process.argv[2];
if (!base || !/^https:\/\//.test(base)) {
  console.error("Usage: register-webhooks.ts https://<your-app>.vercel.app");
  process.exit(1);
}
const uri = `${base.replace(/\/+$/, "")}/api/webhooks/shopify`;

type Sub = { id: string; topic: string; uri: string };
const existing: Sub[] = [];
for (let after: string | null = null; ;) {
  const data: { webhookSubscriptions: Connection<Sub> } = await adminGraphql(WEBHOOK_SUBSCRIPTIONS_QUERY, { after });
  existing.push(...data.webhookSubscriptions.nodes);
  if (!data.webhookSubscriptions.pageInfo?.hasNextPage) break;
  after = data.webhookSubscriptions.pageInfo.endCursor;
}

for (const topic of SYNC_WEBHOOK_TOPICS) {
  if (existing.some((s) => s.topic === topic && s.uri === uri)) {
    console.log(`= ${topic} already registered`);
    continue;
  }
  const result = await adminGraphql<{
    webhookSubscriptionCreate: { webhookSubscription: Sub | null; userErrors: Array<{ field: string[]; message: string }> };
  }>(WEBHOOK_SUBSCRIPTION_CREATE, { topic, uri });
  const { userErrors, webhookSubscription } = result.webhookSubscriptionCreate;
  if (userErrors.length) console.error(`! ${topic}: ${userErrors.map((e) => e.message).join("; ")}`);
  else console.log(`+ ${topic} -> ${webhookSubscription?.uri}`);
}
