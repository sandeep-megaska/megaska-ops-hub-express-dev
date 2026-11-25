-- Megaska storefront: catalog, collections and channel (Browntape) schema.
--
-- The storefront owns its catalog. Products arrive from Shopify's product
-- CSV export (no Shopify app needed); stock arrives from Browntape through
-- the channel API. Every row carries store_id so the same schema can serve
-- more than one brand later (SaaS).
--
-- Access model: the Next.js server connects as a privileged Postgres role.
-- RLS is enabled with no policies, so the public anon/authenticated keys of
-- this Supabase project can read nothing.

-- Supabase keeps extensions out of the public schema.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- array_to_string is only STABLE, so generated columns cannot call it directly.
create function storefront_tags_text(tags text[]) returns text
  language sql immutable parallel safe
  set search_path = ''
  as $$ select pg_catalog.array_to_string(tags, ' ') $$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table stores (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  currency    text not null default 'INR',
  -- Product handles, best seller first; sets products.sales_rank. Seeded from
  -- Shopify, to be replaced by our own order data.
  best_selling_handles  text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products. The handle is the identity (it is also the URL).
-- ---------------------------------------------------------------------------
create table products (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  handle            text not null,
  title             text not null,
  description_html  text not null default '',
  product_type      text not null default '',
  product_category  text not null default '',
  vendor            text not null default '',
  status            text not null default 'active' check (status in ('active', 'draft', 'archived')),
  published         boolean not null default false,
  tags              text[] not null default '{}',
  options           jsonb not null default '[]',   -- [{name, values[]}] in display order
  metafields        jsonb not null default '{}',   -- {"namespace.key": value} from CSV metafield columns
  seo_title         text,
  seo_description   text,
  min_price         numeric(12,2),
  max_price         numeric(12,2),
  sales_rank        integer,                       -- 1 = best seller; drives "best selling" sort
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  search            tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, storefront_tags_text(tags)), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(product_type, '')), 'C')
  ) stored,
  unique (store_id, handle)
);
create index products_store_visible_idx on products (store_id, status, published);
create index products_search_idx on products using gin (search);
create index products_title_trgm_idx on products using gin (title extensions.gin_trgm_ops);

-- Variants. The SKU is what Browntape and the warehouse know them by.
create table product_variants (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references stores(id) on delete cascade,
  product_id            uuid not null references products(id) on delete cascade,
  sku                   text,
  option_values         text[] not null default '{}',  -- aligned with products.options
  position              integer not null,
  price                 numeric(12,2) not null,
  compare_at_price      numeric(12,2),
  barcode               text,
  weight_grams          integer,
  taxable               boolean not null default true,
  hsn_code              text,
  inventory_tracked     boolean not null default true,
  inventory_policy      text not null default 'deny' check (inventory_policy in ('deny', 'continue')),
  inventory_quantity    integer not null default 0,
  -- When inventory_quantity was last set, by Browntape or the first import.
  -- Older readings never overwrite newer ones.
  inventory_updated_at  timestamptz not null default '-infinity',
  -- Who set it: null/'csv' (from a product import) or 'api:<client>' (Browntape).
  -- Once an API client has set stock, CSV imports leave it alone.
  inventory_source      text,
  image_url             text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index product_variants_sku_key on product_variants (store_id, sku) where sku is not null;
create index product_variants_product_idx on product_variants (product_id, position);

create table product_media (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  position    integer not null,
  url         text not null,
  alt         text,
  unique (product_id, position)
);

-- ---------------------------------------------------------------------------
-- Collections: rule-based (tag, type, title, price ...) or a manual list.
-- ---------------------------------------------------------------------------
create table collections (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references stores(id) on delete cascade,
  handle            text not null,
  title             text not null,
  description_html  text not null default '',
  seo_title         text,
  seo_description   text,
  image_url         text,
  sort_order        text not null default 'best_selling'
                    check (sort_order in ('best_selling', 'manual', 'alpha_asc', 'alpha_desc', 'price_asc', 'price_desc', 'created_desc')),
  rules             jsonb,           -- {"match": "all"|"any", "conditions": [...]}; null = manual
  manual_handles    text[] not null default '{}',  -- product handles, in order, for manual collections
  published         boolean not null default true,
  updated_at        timestamptz not null default now(),
  unique (store_id, handle)
);

-- Materialised membership, rebuilt after every import (see lib/collections).
create table collection_products (
  collection_id  uuid not null references collections(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  position       integer not null,
  primary key (collection_id, product_id)
);
create index collection_products_order_idx on collection_products (collection_id, position);
create index collection_products_product_idx on collection_products (product_id);

-- ---------------------------------------------------------------------------
-- SEO: redirects from old URLs (imported from Shopify's redirect export)
-- ---------------------------------------------------------------------------
create table url_redirects (
  id        uuid primary key default gen_random_uuid(),
  store_id  uuid not null references stores(id) on delete cascade,
  path      text not null,
  target    text not null,
  unique (store_id, path)
);

-- ---------------------------------------------------------------------------
-- Channel API (Browntape and other systems)
-- ---------------------------------------------------------------------------
create table api_clients (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  name          text not null,
  key_prefix    text not null unique,      -- shown in lists, used to look the key up
  key_hash      text not null,             -- sha256 of the full key; the key itself is never stored
  scopes        text[] not null default '{}',
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

-- Every stock change, for answering "why does the site show 0 for this SKU?"
create table inventory_log (
  id             bigint generated always as identity primary key,
  store_id       uuid not null references stores(id) on delete cascade,
  sku            text not null,
  quantity       integer not null,
  previous       integer,
  outcome        text not null check (outcome in ('updated', 'unchanged', 'stale', 'unknown_sku')),
  source         text not null,            -- api client name, or 'csv-import'
  request_id     text,
  reading_at     timestamptz not null,     -- when the sender says the reading was taken
  received_at    timestamptz not null default now()
);
create index inventory_log_sku_idx on inventory_log (store_id, sku, received_at desc);
create index inventory_log_received_idx on inventory_log (store_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Import history
-- ---------------------------------------------------------------------------
create table import_runs (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  kind         text not null,              -- products_csv | redirects_csv | collections
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  file_name    text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}',
  warnings     jsonb not null default '[]',
  error        text
);
create index import_runs_store_started_idx on import_runs (store_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Lock everything down: no access through the Supabase Data API keys.
-- ---------------------------------------------------------------------------
alter table stores               enable row level security;
alter table products             enable row level security;
alter table product_variants     enable row level security;
alter table product_media        enable row level security;
alter table collections          enable row level security;
alter table collection_products  enable row level security;
alter table url_redirects        enable row level security;
alter table api_clients          enable row level security;
alter table inventory_log        enable row level security;
alter table import_runs          enable row level security;
