// Server-only configuration. Read lazily so `next build` works without
// secrets, and each missing variable fails loudly where it is first needed.

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const env = {
  databaseUrl: () => required("DATABASE_URL"),
  /** The *.myshopify.com domain, not the public domain. */
  shopifyStoreDomain: () => required("SHOPIFY_STORE_DOMAIN"),
  shopifyApiVersion: () => optional("SHOPIFY_API_VERSION") ?? "2026-10",
  /** A static Admin API token (custom app). Takes precedence over client credentials. */
  shopifyAdminToken: () => optional("SHOPIFY_ADMIN_ACCESS_TOKEN"),
  shopifyClientId: () => optional("SHOPIFY_CLIENT_ID"),
  shopifyClientSecret: () => optional("SHOPIFY_CLIENT_SECRET"),
  /** Secret Shopify signs webhooks with: the app's client secret. */
  shopifyWebhookSecret: () =>
    optional("SHOPIFY_WEBHOOK_SECRET") ?? required("SHOPIFY_CLIENT_SECRET"),
  storeSlug: () => optional("STORE_SLUG") ?? "megaska",
  storeName: () => optional("STORE_NAME") ?? "Megaska",
  cronSecret: () => required("CRON_SECRET"),
  /** Only "true" lets search engines index the site. Keep it off on *.vercel.app. */
  siteIndexable: () => optional("SITE_INDEXABLE") === "true",
};
