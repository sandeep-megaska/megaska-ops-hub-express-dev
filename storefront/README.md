# Megaska storefront (Phase 1)

A storefront for megaska.com built on Next.js 16, Supabase Postgres and Vercel.
It lives in this repo but is a **separate app**, deployed as its own Vercel
project with Root Directory `storefront`.

**Phase 1 scope:** a read-only copy of the Shopify catalog, plus product and
collection pages to check it against the live store. Shopify stays the
source of truth, and checkout still happens on megaska.com: the buy button
opens a Shopify cart permalink.

## How the sync works

```
Shopify ──webhooks──▶ /api/webhooks/shopify ──▶ refetch that product/collection ──▶ Postgres ──▶ revalidateTag
        ◀─Admin GraphQL─ /api/cron/full-sync (nightly 03:10 IST) ──▶ full reconciliation, deletes what Shopify removed
```

- **Webhooks** (product/collection create, update and delete, plus
  inventory level updates). Each delivery is HMAC-verified and recorded in
  `webhook_events`; retried deliveries do nothing. The handler always
  refetches the resource from the Admin API rather than trusting the
  payload, so deliveries that arrive out of order still end in the latest
  state. An older write never overwrites a newer one (`shopify_updated_at`
  guard).
- **Stock (Browntape).** Megaska's stock is managed in Genesys Browntape,
  which pushes it into Shopify. Every push fires `inventory_levels/update`.
  We apply the payload's `available` number directly, with no Admin API
  call, so a bulk push of hundreds of SKUs can't hit Shopify's rate limit or
  its 5-second webhook timeout. A per-variant `inventory_updated_at` keeps
  the newest reading when pushes and syncs race. This relies on there being
  one stock location (Jaipur-1). If you add a second one, set
  `SHOPIFY_MULTI_LOCATION=true` and totals are reread from Shopify instead.
- **Full sync** fixes anything a webhook missed, and also copies Shopify's
  URL redirects (156 today) so old links keep working after the cutover.
- **Pages** are cached with `'use cache'` plus `cacheTag`. Postgres is hit
  only after a webhook or the nightly sync invalidates a tag.
- **Images** are served straight from Shopify's CDN using its `width`
  parameter, so there are no Vercel Image Optimization charges. Phase 3
  moves them to Supabase Storage.

## Schema (`supabase/migrations`)

| Table | Holds |
|---|---|
| `stores` | One row per brand. Every table carries `store_id`, ready for SaaS. |
| `products`, `product_variants`, `product_media` | Catalog, prices, stock, HSN, full-text search column |
| `collections`, `collection_products` | Collections and their product order |
| `url_redirects` | Shopify redirects, used for 308s on old URLs |
| `sync_runs`, `webhook_events` | Audit trail and idempotency for the sync |

RLS is on for every table with no policies, so Supabase's public API keys
can't read anything. The app connects with the database role.

## One-time setup

1. **Supabase.** Done: project `megaska-storefront` (ref
   `ltzgsesozhwakdundnsi`, ap-south-1 Mumbai), with the schema applied. For
   future migrations run `MIGRATION_DATABASE_URL=... npm run db:migrate`
   (applied migrations are tracked in `storefront_migrations`).
2. **Shopify app** (read-only). In the Shopify Dev Dashboard, create an app
   with scopes `read_products`, `read_inventory` and
   `read_online_store_navigation`, and install it on the Megaska store. Put
   its client ID and secret in the environment.
3. **Vercel.** Create a new project from this repo:
   - Root Directory: `storefront`
   - Add the variables from `.env.example`
   - Leave `SITE_INDEXABLE` unset

   Deploy. You get `https://<name>.vercel.app`.
4. **First import:**
   `node --env-file=.env.local --experimental-strip-types scripts/full-sync.ts`,
   or call the cron route with the secret:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<name>.vercel.app/api/cron/full-sync`
5. **Webhooks:**
   `node --env-file=.env.local --experimental-strip-types scripts/register-webhooks.ts https://<name>.vercel.app`

## Checks

```
npm test                                     # unit tests (mappers, HMAC, formatting)
TEST_DATABASE_URL=... npm run test:db        # sync writes against a real Postgres
npm run typecheck && npm run lint && npm run build
```

## Before the domain cutover (not Phase 1)

- Set `SITE_INDEXABLE=true`. Until then every response carries
  `X-Robots-Tag: noindex` and robots.txt disallows everything, so the
  vercel.app copy can't compete with megaska.com in Google.
- Add a sitemap, catch-all redirects for non-product paths, the Meta and
  Google product feeds, and analytics.
