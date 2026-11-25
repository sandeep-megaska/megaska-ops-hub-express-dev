import { env } from "../env.ts";

// Minimal Shopify Admin GraphQL client for the catalog sync.
// Auth: a static custom-app token (SHOPIFY_ADMIN_ACCESS_TOKEN), or a Dev
// Dashboard app's client credentials, exchanged for a short-lived token.

type TokenCache = { token: string; expiresAt: number };
let cachedToken: TokenCache | undefined;

async function getAccessToken(): Promise<string> {
  const staticToken = env.shopifyAdminToken();
  if (staticToken) return staticToken;

  if (cachedToken && cachedToken.expiresAt - 60_000 > Date.now()) return cachedToken.token;

  const clientId = env.shopifyClientId();
  const clientSecret = env.shopifyClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error("Set SHOPIFY_ADMIN_ACCESS_TOKEN, or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET");
  }
  const res = await fetch(`https://${env.shopifyStoreDomain()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange failed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return cachedToken.token;
}

export class ShopifyGraphQLError extends Error {
  readonly errors: unknown;
  constructor(message: string, errors: unknown) {
    super(message);
    this.name = "ShopifyGraphQLError";
    this.errors = errors;
  }
}

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number }; requestedQueryCost?: number } };
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Run an Admin GraphQL operation. Retries throttling and transient failures. */
export async function adminGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const url = `https://${env.shopifyStoreDomain()}/admin/api/${env.shopifyApiVersion()}/graphql.json`;
  const maxAttempts = 6;

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-shopify-access-token": await getAccessToken(),
        },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      });
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await sleep(backoff(attempt));
      continue;
    }

    if (res.status === 401 && cachedToken) {
      cachedToken = undefined; // expired client-credentials token: fetch a new one
      if (attempt < maxAttempts) continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= maxAttempts) throw new Error(`Shopify Admin API HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoff(attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify Admin API HTTP ${res.status}: ${await res.text()}`);

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < maxAttempts) {
        const status = body.extensions?.cost?.throttleStatus;
        const needed = body.extensions?.cost?.requestedQueryCost ?? 0;
        const waitMs = status && status.restoreRate > 0
          ? Math.max(500, ((needed - status.currentlyAvailable) / status.restoreRate) * 1000)
          : backoff(attempt);
        await sleep(waitMs);
        continue;
      }
      throw new ShopifyGraphQLError(body.errors.map((e) => e.message).join("; "), body.errors);
    }
    if (!body.data) throw new ShopifyGraphQLError("Shopify returned no data", body);
    return body.data;
  }
}

function backoff(attempt: number): number {
  return Math.min(10_000, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
}
