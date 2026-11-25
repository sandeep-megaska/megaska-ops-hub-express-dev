# Megaska storefront

A storefront for megaska.com built on Next.js 16, Supabase Postgres and Vercel.
It lives in this repo but is a **separate app**, deployed as its own Vercel
project with Root Directory `storefront`.

There is **no Shopify app**. The storefront owns its catalog:

```
Shopify product CSV export ──upload in /admin──▶ products, variants, images ─┐
data/megaska-collections.json ──────────────────▶ 31 collections (rules) ────┼─▶ Postgres ─▶ cached pages
Shopify redirects CSV export ──upload in /admin──▶ old URL → new URL ────────┘
Browntape (Ginesys OMS) ──POST /api/channel/v1/inventory──▶ stock by SKU
```

Checkout still happens on megaska.com in this phase.

## Pieces

| Piece | Where | Notes |
|---|---|---|
| Product import | `lib/import/` | Reads Shopify's standard export. Products are matched by handle and variants by SKU. One import is one transaction: a bad file changes nothing. "Whole catalog" mode archives products missing from the file. |
| Collections | `lib/collections/`, `data/megaska-collections.json` | Megaska's 31 collections as taken from Shopify: 20 rule-based (tag, type, title, price) and 11 hand-picked, plus the best-seller order. Rebuilt after every import, so a newly tagged product shows up by itself. |
| Redirects | `lib/import/redirects.ts` | Shopify's redirect export. Targets with `?variant=<Shopify id>` go to the product page. |
| Channel API | `lib/channel/`, `app/api/channel/v1/` | For Browntape. Spec to share: [`docs/channel-api.md`](docs/channel-api.md). |
| Admin | `/admin` | Password-protected (user `admin`, password from `ADMIN_PASSWORD`). Imports, API keys, import history and recent stock updates. |
| Pages | `app/` | Home, collections and products, cached with `'use cache'`. Imports and stock pushes refresh them. Images come from Shopify's CDN. |

### Stock rules (Browntape)

- Quantities are absolute, per SKU, so retries are harmless.
- The newest reading wins (by `updated_at`, or arrival time when none is sent).
  This is checked on the locked row, so concurrent pushes can't let an older
  reading win.
- The product CSV sets stock only for SKUs that no API client has set yet.
  Once Browntape has sent a SKU's stock, re-importing the CSV never overwrites it.
- Every change is recorded in `inventory_log`, and the last 30 show on the admin page.

## Setup

1. **Supabase.** Done: project `megaska-storefront` (`ltzgsesozhwakdundnsi`,
   Mumbai), with the schema applied. Future migrations:
   `MIGRATION_DATABASE_URL=... npm run db:migrate`.
2. **Vercel.** Create a new project from this repo:
   - Root Directory: `storefront`
   - Add the variables in `.env.example`
   - Leave `SITE_INDEXABLE` unset

   Deploy. You get `https://<name>.vercel.app`.
3. **Fill the catalog** at `https://<name>.vercel.app/admin`, in this order:
   1. Products. In Shopify: Products → Export → All products → "CSV for Excel,
      Numbers, or other spreadsheet programs". Upload the file and tick
      "whole catalog".
   2. Collections. Click Import with no file to load Megaska's 31 collections.
   3. Redirects. In Shopify: Content → Menus → View URL redirects → Export.
4. **Browntape.** Create an API key on the admin page and share it with
   Ginesys together with `docs/channel-api.md`.

CLI alternatives (need `.env.local` with `DATABASE_URL`):

```
npm run import -- products products_export.csv --full
npm run import -- collections
npm run import -- redirects url_redirects.csv
npm run api-key:create -- Browntape
```

## Checks

```
npm test                                     # unit tests: CSV, Shopify mapping, rules, API validation
TEST_DATABASE_URL=... npm run test:db        # imports and stock rules against a real Postgres
npm run typecheck && npm run lint && npm run build
```

## Before the domain cutover

- Set `SITE_INDEXABLE=true`. Until then every response carries
  `X-Robots-Tag: noindex` and robots.txt disallows everything, so the
  vercel.app copy can't compete with megaska.com in Google.
- Still to do: sitemap, redirects for non-product paths, Meta and Google
  product feeds, analytics, and pages (`/pages/...`).
