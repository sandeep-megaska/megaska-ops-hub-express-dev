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
  storeSlug: () => optional("STORE_SLUG") ?? "megaska",
  storeName: () => optional("STORE_NAME") ?? "Megaska",
  /** Password for /admin (user name "admin"). Admin is disabled while unset. */
  adminPassword: () => optional("ADMIN_PASSWORD"),
  /** Only "true" lets search engines index the site. Keep it off on *.vercel.app. */
  siteIndexable: () => optional("SITE_INDEXABLE") === "true",
};
