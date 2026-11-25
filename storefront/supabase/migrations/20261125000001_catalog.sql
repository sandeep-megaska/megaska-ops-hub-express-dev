-- Megaska storefront: catalog schema (Phase 1).
--
-- Shopify stays the source of truth in Phase 1. These tables are a read
-- model that the sync jobs fill from the Admin API and keep fresh from
-- webhooks. Every row carries store_id so the same schema can serve more
-- than one brand later (SaaS) without a rewrite.
--
-- Access model: the Next.js server connects as a privileged Postgres role.
-- RLS is enabled with no policies, so the public anon/authenticated keys of
-- this Supabase project can read nothing from these tables.

create extension if not exists pg_trgm;

-- array_to_string is only STABLE, so generated columns cannot call it directly.
create function storefront_tags_text(tags text[]) returns text
  language sql immutable parallel safe
  as $$ select array_to_string(tags, ' ') $$;

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------
create table stores (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  shopify_domain  text not null unique,          -- e.g. megaska.myshopify.com
  currency        text not null default 'INR',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
create table products (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references stores(id) on delete cascade,
  shopify_id          bigint not null,
  handle              text not null,
  title               text not null,
  description_html    text not null default '',
  product_type        text not null default '',
  vendor              text not null default '',
  status              text not null,                 -- Shopify ProductStatus: ACTIVE, DRAFT, ARCHIVED, UNLISTED
  tags                text[] not null default '{}',
  options             jsonb not null default '[]',   -- [{name, position, values[]}]
  metafields          jsonb not null default '{}',   -- {"namespace.key": {type, value}}
  seo_title           text,
  seo_description     text,
  template_suffix     text,
  published_at        timestamptz,                   -- null = not on the Online Store
  min_price           numeric(12,2),
  max_price           numeric(12,2),
  shopify_created_at  timestamptz,
  shopify_updated_at  timestamptz not null,
  synced_at           timestamptz not null default now(),
  search              tsvector generated always as (
    setweight(to_tsvector('simple'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple'::regconfig, storefront_tags_text(tags)), 'B') ||
    setweight(to_tsvector('simple'::regconfig, coalesce(product_type, '')), 'C')
  ) stored,
  unique (store_id, shopify_id),
  unique (store_id, handle)
);
create index products_store_visible_idx on products (store_id, status, published_at);
create index products_search_idx on products using gin (search);
create index products_title_trgm_idx on products using gin (title gin_trgm_ops);

create table product_variants (
  id                    uuid primary key default gen_random_uuid(),
  store_id              uuid not null references stores(id) on delete cascade,
  product_id            uuid not null references products(id) on delete cascade,
  shopify_id            bigint not null,
  inventory_item_id     bigint,
  title                 text not null,
  sku                   text,
  position              integer not null,
  price                 numeric(12,2) not null,
  compare_at_price      numeric(12,2),
  selected_options      jsonb not null default '[]', -- [{name, value}]
  taxable               boolean not null default true,
  inventory_tracked     boolean not null default true,
  inventory_policy      text not null default 'DENY' check (inventory_policy in ('DENY', 'CONTINUE')),
  inventory_quantity    integer not null default 0,  -- sum across locations
  hsn_code              text,
  image_shopify_id      bigint,
  synced_at             timestamptz not null default now(),
  unique (store_id, shopify_id)
);
create index product_variants_product_idx on product_variants (product_id, position);
create index product_variants_inventory_item_idx on product_variants (store_id, inventory_item_id);
create index product_variants_sku_idx on product_variants (store_id, sku);

create table product_media (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  product_id    uuid not null references products(id) on delete cascade,
  shopify_id    bigint not null,
  media_type    text not null,              -- IMAGE, VIDEO, EXTERNAL_VIDEO, MODEL_3D
  position      integer not null,
  url           text not null,              -- image URL, or preview image for non-images
  alt           text,
  width         integer,
  height        integer,
  unique (store_id, shopify_id)
);
create index product_media_product_idx on product_media (product_id, position);

-- ---------------------------------------------------------------------------
-- Collections
-- ---------------------------------------------------------------------------
create table collections (
  id                  uuid primary key default gen_random_uuid(),
  store_id            uuid not null references stores(id) on delete cascade,
  shopify_id          bigint not null,
  handle              text not null,
  title               text not null,
  description_html    text not null default '',
  sort_order          text not null,
  image_url           text,
  image_alt           text,
  image_width         integer,
  image_height        integer,
  seo_title           text,
  seo_description     text,
  template_suffix     text,
  metafields          jsonb not null default '{}',
  shopify_updated_at  timestamptz not null,
  synced_at           timestamptz not null default now(),
  unique (store_id, shopify_id),
  unique (store_id, handle)
);

create table collection_products (
  collection_id  uuid not null references collections(id) on delete cascade,
  product_id     uuid not null references products(id) on delete cascade,
  position       integer not null,
  primary key (collection_id, product_id)
);
create index collection_products_order_idx on collection_products (collection_id, position);
create index collection_products_product_idx on collection_products (product_id);

-- ---------------------------------------------------------------------------
-- SEO: Shopify URL redirects, so old links keep working after the cutover
-- ---------------------------------------------------------------------------
create table url_redirects (
  id          uuid primary key default gen_random_uuid(),
  store_id    uuid not null references stores(id) on delete cascade,
  shopify_id  bigint,
  path        text not null,
  target      text not null,
  unique (store_id, path)
);

-- ---------------------------------------------------------------------------
-- Sync bookkeeping
-- ---------------------------------------------------------------------------
create table sync_runs (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid not null references stores(id) on delete cascade,
  kind         text not null,                 -- full | product | collection | inventory
  status       text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}',
  error        text
);
create index sync_runs_store_started_idx on sync_runs (store_id, started_at desc);

-- One row per Shopify webhook delivery; the unique key makes retries no-ops.
create table webhook_events (
  id            uuid primary key default gen_random_uuid(),
  store_id      uuid not null references stores(id) on delete cascade,
  webhook_id    text not null,                -- X-Shopify-Webhook-Id
  topic         text not null,
  resource_id   bigint,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'received' check (status in ('received', 'processed', 'failed', 'ignored')),
  error         text,
  unique (store_id, webhook_id)
);
create index webhook_events_received_idx on webhook_events (store_id, received_at desc);

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
alter table sync_runs            enable row level security;
alter table webhook_events       enable row level security;
