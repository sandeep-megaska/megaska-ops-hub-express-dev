// Runs the sync's database writes against a real Postgres.
//   TEST_DATABASE_URL=postgres://... npm run test:db
// The database must already have the migrations applied. Uses its own store
// slug and deletes it afterwards.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ShopifyProduct } from "../lib/shopify/types.ts";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.STORE_SLUG = `test-${process.pid}`;
  process.env.SHOPIFY_STORE_DOMAIN = `test-${process.pid}.myshopify.com`;
}

const { getPool, closePool } = await import("../lib/db.ts");
const { ensureStore } = await import("../lib/sync/store.ts");
const { mapProduct, mapCollection } = await import("../lib/shopify/map.ts");
const { upsertProduct, deleteProduct } = await import("../lib/sync/products.ts");
const { upsertCollection } = await import("../lib/sync/collections.ts");
const { handleWebhook } = await import("../lib/sync/webhooks.ts");

const fixture = JSON.parse(readFileSync(new URL("./fixtures/product.json", import.meta.url), "utf8")) as ShopifyProduct;
const skip = url ? false : "set TEST_DATABASE_URL to run";

after(async () => {
  if (!url) return;
  await getPool().query(`delete from stores where slug = $1`, [process.env.STORE_SLUG]);
  await closePool();
});

const collection = (id: string, handle: string) =>
  mapCollection({
    id: `gid://shopify/Collection/${id}`, handle, title: handle, descriptionHtml: "", updatedAt: "2026-10-22T15:41:39Z",
    sortOrder: "MANUAL", templateSuffix: null, seo: { title: null, description: null }, image: null, metafields: { nodes: [] },
  });

test("product upsert, update, membership and delete", { skip }, async () => {
  const storeId = await ensureStore();
  const db = getPool();
  const [c1, c2] = fixture.collections.nodes.map((c) => c.id.split("/").pop()!);

  await upsertCollection(storeId, collection(c1, "one-piece"), []);
  const tags = await upsertProduct(storeId, mapProduct(fixture));
  assert.ok(tags.includes(`product:${fixture.handle}`));
  assert.ok(tags.includes("collection:one-piece"));

  const counts = await db.query(
    `select (select count(*) from product_variants v join products p on p.id = v.product_id where p.store_id = $1)::int as variants,
            (select count(*) from product_media m join products p on p.id = m.product_id where p.store_id = $1)::int as media,
            (select count(*) from collection_products cp join collections c on c.id = cp.collection_id where c.store_id = $1)::int as members`,
    [storeId],
  );
  assert.deepEqual(counts.rows[0], { variants: 5, media: 5, members: 1 });

  const search = await db.query(
    `select handle from products where store_id = $1 and search @@ plainto_tsquery('simple', 'thoughtfully')`,
    [storeId],
  );
  assert.equal(search.rows.length, 0, "description is not indexed");
  const byTitle = await db.query(
    `select handle from products where store_id = $1 and search @@ plainto_tsquery('simple', 'cutout monokini')`,
    [storeId],
  );
  assert.equal(byTitle.rows[0]?.handle, fixture.handle);

  // Newer version: one variant and one image removed, renamed handle, price change.
  const v2 = structuredClone(fixture);
  v2.updatedAt = "2030-01-01T00:00:00Z";
  v2.handle = "renamed-handle";
  v2.variants.nodes.pop();
  v2.media.nodes.pop();
  v2.variants.nodes[0].price = "899.00";
  const tags2 = await upsertProduct(storeId, mapProduct(v2));
  assert.ok(tags2.includes("product:renamed-handle"));
  assert.ok(tags2.includes(`product:${fixture.handle}`), "old handle is invalidated too");
  const row = await db.query(
    `select p.handle, p.min_price::text, (select count(*)::int from product_variants where product_id = p.id) as variants,
            (select count(*)::int from product_media where product_id = p.id) as media
     from products p where p.store_id = $1`,
    [storeId],
  );
  assert.deepEqual(row.rows[0], { handle: "renamed-handle", min_price: "899.00", variants: 4, media: 4 });

  // An older version arriving late must not overwrite the newer one.
  const stale = await upsertProduct(storeId, mapProduct(fixture));
  assert.deepEqual(stale, []);
  const still = await db.query(`select handle from products where store_id = $1`, [storeId]);
  assert.equal(still.rows[0].handle, "renamed-handle");

  // Collection sync sets order; a second collection joins.
  await upsertCollection(storeId, collection(c2, "bestsellers"), [legacy(fixture.id)]);
  const members = await db.query(
    `select c.handle, cp.position from collection_products cp join collections c on c.id = cp.collection_id
     where c.store_id = $1 order by c.handle`,
    [storeId],
  );
  assert.deepEqual(members.rows, [{ handle: "bestsellers", position: 1 }, { handle: "one-piece", position: 1 }]);

  // Removing the product from a collection on the collection side.
  const ctags = await upsertCollection(storeId, collection(c2, "bestsellers"), []);
  assert.ok(ctags.includes("product:renamed-handle"));

  const deleted = await deleteProduct(storeId, legacy(fixture.id));
  assert.ok(deleted.includes("product:renamed-handle"));
  assert.ok(deleted.includes("collection:one-piece"));
  const left = await db.query(`select count(*)::int as n from product_variants where store_id = $1`, [storeId]);
  assert.equal(left.rows[0].n, 0, "variants cascade");
});

test("handle collision parks the previous owner's handle", { skip }, async () => {
  const storeId = await ensureStore();
  const a = structuredClone(fixture);
  a.id = "gid://shopify/Product/111"; a.handle = "shared"; a.collections.nodes = [];
  a.variants.nodes = a.variants.nodes.map((v, i) => ({ ...v, id: `gid://shopify/ProductVariant/1110${i}` }));
  a.media.nodes = a.media.nodes.map((m, i) => ({ ...m, id: `gid://shopify/MediaImage/1110${i}` }));
  const b = structuredClone(a);
  b.id = "gid://shopify/Product/222";
  b.variants.nodes = b.variants.nodes.map((v, i) => ({ ...v, id: `gid://shopify/ProductVariant/2220${i}` }));
  b.media.nodes = b.media.nodes.map((m, i) => ({ ...m, id: `gid://shopify/MediaImage/2220${i}` }));
  await upsertProduct(storeId, mapProduct(a));
  await upsertProduct(storeId, mapProduct(b));
  const rows = await getPool().query(
    `select shopify_id, handle from products where store_id = $1 and shopify_id in (111, 222) order by shopify_id`,
    [storeId],
  );
  assert.deepEqual(rows.rows, [{ shopify_id: "111", handle: "shared--111" }, { shopify_id: "222", handle: "shared" }]);
});

test("webhook deliveries are idempotent", { skip }, async () => {
  const storeId = await ensureStore();
  const first = await handleWebhook(storeId, { webhookId: "wh-1", topic: "products/delete", payload: { id: 222 } });
  assert.equal(first.status, "processed");
  assert.ok(first.tags.includes("product:shared"));
  const again = await handleWebhook(storeId, { webhookId: "wh-1", topic: "products/delete", payload: { id: 222 } });
  assert.equal(again.status, "duplicate");
  const other = await handleWebhook(storeId, { webhookId: "wh-2", topic: "orders/create", payload: { id: 5 } });
  assert.equal(other.status, "ignored");
});

function legacy(gid: string) {
  return gid.split("/").pop()!;
}
