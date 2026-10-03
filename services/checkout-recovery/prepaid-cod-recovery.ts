import { createHmac, timingSafeEqual } from "node:crypto";

// Prepaid -> COD recovery for native Shopify Checkout.
//
// On non-Plus stores nothing at checkout can re-price an order by the payment
// method the shopper taps, so a cart the drawer marked prepaid only offers online
// payment (the prepaid discount is already applied). A shopper who hesitates there
// cannot fall back to Cash on Delivery. This finds those abandoned prepaid
// checkouts and offers a one-tap link that rebuilds the same cart as a COD cart.
// The shopper still passes the normal OTP-gated checkout, so no unverified COD
// order can be created this way.

type Graphql = <T>(query: string, variables?: Record<string, unknown>, options?: { shopDomain?: string | null }) => Promise<T>;

// Loaded lazily so this module stays importable in node:test.
const defaultGraphql: Graphql = async (query, variables, options) =>
  ((await import("../shopify/admin.ts")).adminGraphql as Graphql)(query, variables, options);

export const PREPAID_COD_RECOVERY_EVENT = "PREPAID_COD_RECOVERY_SENT";
const ENTITY_TYPE = "SHOPIFY_ABANDONED_CHECKOUT";
const TOKEN_TTL_MS = 7 * 86_400_000;
const MIN_AGE_MS = 30 * 60_000;
const MAX_AGE_MS = 24 * 3_600_000;
const MAX_ITEMS = 20;

const ABANDONED_CHECKOUTS_QUERY = `query PrepaidAbandonedCheckouts($query: String!, $after: String) {
  abandonedCheckouts(first: 50, after: $after, reverse: true, query: $query) {
    nodes {
      id
      createdAt
      completedAt
      abandonedCheckoutUrl
      customAttributes { key value }
      customer { firstName defaultEmailAddress { emailAddress } lastOrder { createdAt } }
      lineItems(first: 20) { nodes { quantity variant { id } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

type AbandonedCheckoutNode = {
  id?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
  abandonedCheckoutUrl?: string | null;
  customAttributes?: Array<{ key?: string | null; value?: string | null }> | null;
  customer?: {
    firstName?: string | null;
    defaultEmailAddress?: { emailAddress?: string | null } | null;
    lastOrder?: { createdAt?: string | null } | null;
  } | null;
  lineItems?: { nodes?: Array<{ quantity?: number | null; variant?: { id?: string | null } | null }> | null } | null;
};

export type RecoveryItem = { variantId: number; quantity: number };

export type PrepaidCodCandidate = {
  checkoutId: string;
  email: string;
  firstName: string | null;
  abandonedCheckoutUrl: string | null;
  items: RecoveryItem[];
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function attribute(node: AbandonedCheckoutNode, key: string) {
  const match = (node.customAttributes ?? []).find((entry) => entry?.key === key);
  return String(match?.value ?? "").trim();
}

function numericId(gid: string | null | undefined): number | null {
  const match = String(gid ?? "").match(/(\d+)$/);
  const value = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

// An abandoned checkout qualifies when the drawer marked it prepaid, the shopper
// verified their phone through the OTP gate, it has been idle long enough, and
// the customer has not ordered since it was created.
export function selectPrepaidCodCandidates(nodes: AbandonedCheckoutNode[], now: Date): PrepaidCodCandidate[] {
  const candidates: PrepaidCodCandidate[] = [];
  for (const node of nodes) {
    if (!node?.id || node.completedAt) continue;
    const createdAt = node.createdAt ? new Date(node.createdAt).getTime() : NaN;
    if (!Number.isFinite(createdAt)) continue;
    const age = now.getTime() - createdAt;
    if (age < MIN_AGE_MS || age > MAX_AGE_MS) continue;
    if (attribute(node, "loopd2c_payment_intent").toLowerCase() !== "prepaid") continue;
    if (attribute(node, "megaska_phone_verified").toLowerCase() !== "true") continue;
    const lastOrderAt = node.customer?.lastOrder?.createdAt ? new Date(node.customer.lastOrder.createdAt).getTime() : NaN;
    if (Number.isFinite(lastOrderAt) && lastOrderAt >= createdAt) continue;
    const email = String(node.customer?.defaultEmailAddress?.emailAddress ?? "").trim().toLowerCase();
    if (!EMAIL.test(email)) continue;
    const items = (node.lineItems?.nodes ?? [])
      .map((line) => ({ variantId: numericId(line?.variant?.id), quantity: Math.max(0, Math.floor(Number(line?.quantity ?? 0))) }))
      .filter((line): line is RecoveryItem => line.variantId !== null && line.quantity > 0)
      .slice(0, MAX_ITEMS);
    if (!items.length) continue;
    candidates.push({
      checkoutId: node.id,
      email,
      firstName: String(node.customer?.firstName ?? "").trim() || null,
      abandonedCheckoutUrl: node.abandonedCheckoutUrl ?? null,
      items,
    });
  }
  return candidates;
}

export async function listAbandonedCheckouts(
  input: { shopDomain: string; now: Date },
  graphql: Graphql = defaultGraphql,
): Promise<AbandonedCheckoutNode[]> {
  const since = new Date(input.now.getTime() - MAX_AGE_MS).toISOString();
  const nodes: AbandonedCheckoutNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < 5; page += 1) {
    const data: { abandonedCheckouts: { nodes: AbandonedCheckoutNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await graphql(ABANDONED_CHECKOUTS_QUERY, { query: `created_at:>='${since}'`, after }, { shopDomain: input.shopDomain });
    nodes.push(...(data.abandonedCheckouts?.nodes ?? []));
    if (!data.abandonedCheckouts?.pageInfo?.hasNextPage) break;
    after = data.abandonedCheckouts.pageInfo.endCursor;
  }
  return nodes;
}

// ---- Signed, stateless link token: shop + checkout + items + expiry ----

type TokenPayload = { s: string; c: string; i: Array<[number, number]>; e: number };

function signingSecret(env: Record<string, string | undefined> = process.env): string | null {
  const secret = String(env.CHECKOUT_RECOVERY_SIGNING_SECRET ?? "").trim();
  return secret.length >= 32 ? secret : null;
}

function sign(body: string, secret: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createCodRecoveryToken(
  input: { shopId: string; checkoutId: string; items: RecoveryItem[]; now: Date },
  secret: string,
): string {
  const payload: TokenPayload = {
    s: input.shopId,
    c: input.checkoutId,
    i: input.items.map((item) => [item.variantId, item.quantity]),
    e: input.now.getTime() + TOKEN_TTL_MS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyCodRecoveryToken(
  token: string,
  input: { shopId: string; now: Date },
  secret: string | null = signingSecret(),
): { checkoutId: string; items: RecoveryItem[] } | null {
  if (!secret || typeof token !== "string" || token.length > 4000) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = Buffer.from(sign(body, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || payload.s !== input.shopId || typeof payload.e !== "number" || payload.e < input.now.getTime()) return null;
  const items = (Array.isArray(payload.i) ? payload.i : [])
    .map(([variantId, quantity]) => ({ variantId: Number(variantId), quantity: Number(quantity) }))
    .filter((item) => Number.isSafeInteger(item.variantId) && item.variantId > 0 && Number.isSafeInteger(item.quantity) && item.quantity > 0)
    .slice(0, MAX_ITEMS);
  return items.length ? { checkoutId: String(payload.c), items } : null;
}

// ---- Email ----

export function buildCodRecoveryEmail(input: { shopName: string; firstName: string | null; codLink: string; onlineLink: string | null }) {
  const greeting = input.firstName ? `Hi ${input.firstName},` : "Hi,";
  const lines = [
    greeting,
    "",
    `Your ${input.shopName} order is still waiting for you.`,
    "",
    "Prefer to pay when it arrives? Place the same order with Cash on Delivery:",
    input.codLink,
  ];
  if (input.onlineLink) lines.push("", "Or finish paying online and keep your prepaid discount:", input.onlineLink);
  lines.push("", "Free size exchange on every order.", "", `— ${input.shopName}`);
  return { subject: "Pay on delivery? Your order is one tap away", text: lines.join("\n") };
}

// ---- Run ----

type RecoveryDb = {
  shop: { findMany(args: unknown): Promise<Array<{ id: string; shopDomain: string; primaryDomain: string | null; shopName: string | null }>> };
  auditEvent: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
    create(args: unknown): Promise<unknown>;
  };
};

type SendEmail = (input: { shopId: string; to: string; subject: string; text: string; checkoutId: string }) => Promise<{ sent: boolean }>;

const defaultSendEmail: SendEmail = async (input) => {
  const { sendCustomerEmail } = await import("../notifications/resend.ts");
  const result = await sendCustomerEmail({
    shopId: input.shopId,
    to: input.to,
    eventType: "CHECKOUT_RECOVERY",
    subject: input.subject,
    text: input.text,
    usageContext: { sourceType: "PREPAID_COD_RECOVERY", sourceId: input.checkoutId, idempotencyKey: `prepaid-cod-recovery:${input.checkoutId}` },
  });
  return { sent: !result.skipped && result.success === true };
};

export type PrepaidCodRecoverySummary = { enabled: boolean; shops: number; candidates: number; sent: number; alreadySent: number; failed: number };

// Opt-in per shop: PREPAID_COD_RECOVERY_SHOPS is a comma-separated list of
// myshopify domains, and CHECKOUT_RECOVERY_SIGNING_SECRET (32+ chars) must be set.
export async function runPrepaidCodRecovery(
  input: { now?: Date; maxSends?: number },
  dependencies: { db?: RecoveryDb; listCheckouts?: typeof listAbandonedCheckouts; sendEmail?: SendEmail; env?: Record<string, string | undefined> } = {},
): Promise<PrepaidCodRecoverySummary> {
  const now = input.now ?? new Date();
  const env = dependencies.env ?? process.env;
  const secret = signingSecret(env);
  const allowed = String(env.PREPAID_COD_RECOVERY_SHOPS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const summary: PrepaidCodRecoverySummary = { enabled: Boolean(secret && allowed.length), shops: 0, candidates: 0, sent: 0, alreadySent: 0, failed: 0 };
  if (!summary.enabled || !secret) return summary;

  const db = dependencies.db ?? ((await import("../db/prisma.ts")).prisma as unknown as RecoveryDb);
  const listCheckouts = dependencies.listCheckouts ?? listAbandonedCheckouts;
  const sendEmail = dependencies.sendEmail ?? defaultSendEmail;
  let budget = input.maxSends ?? 20;

  const shops = await db.shop.findMany({ where: { shopDomain: { in: allowed } }, select: { id: true, shopDomain: true, primaryDomain: true, shopName: true } });
  for (const shop of shops) {
    summary.shops += 1;
    let candidates: PrepaidCodCandidate[];
    try {
      candidates = selectPrepaidCodCandidates(await listCheckouts({ shopDomain: shop.shopDomain, now }), now);
    } catch {
      summary.failed += 1;
      continue;
    }
    summary.candidates += candidates.length;
    const host = String(shop.primaryDomain || shop.shopDomain).replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    for (const candidate of candidates) {
      if (budget <= 0) break;
      const existing = await db.auditEvent.findFirst({ where: { eventType: PREPAID_COD_RECOVERY_EVENT, entityType: ENTITY_TYPE, entityId: candidate.checkoutId }, select: { id: true } });
      if (existing) { summary.alreadySent += 1; continue; }
      budget -= 1;
      const token = createCodRecoveryToken({ shopId: shop.id, checkoutId: candidate.checkoutId, items: candidate.items, now }, secret);
      const email = buildCodRecoveryEmail({
        shopName: shop.shopName || host,
        firstName: candidate.firstName,
        codLink: `https://${host}/apps/loopd2c/checkout/switch-cod?t=${encodeURIComponent(token)}`,
        onlineLink: candidate.abandonedCheckoutUrl,
      });
      try {
        const result = await sendEmail({ shopId: shop.id, to: candidate.email, subject: email.subject, text: email.text, checkoutId: candidate.checkoutId });
        if (!result.sent) { summary.failed += 1; continue; }
        // Recorded only after an accepted send; a failed send is retried next run.
        await db.auditEvent.create({ data: { actorType: "system", eventType: PREPAID_COD_RECOVERY_EVENT, entityType: ENTITY_TYPE, entityId: candidate.checkoutId, payload: { shopId: shop.id, channel: "EMAIL" } } });
        summary.sent += 1;
      } catch {
        summary.failed += 1;
      }
    }
  }
  return summary;
}
