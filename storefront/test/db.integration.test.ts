// Imports and the channel API against a real Postgres.
//   TEST_DATABASE_URL=postgres://... npm run test:db
// Needs the migrations applied. Uses its own store and deletes it afterwards.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const url = process.env.TEST_DATABASE_URL;
if (url) {
  process.env.DATABASE_URL = url;
  process.env.STORE_SLUG = `test-${process.pid}`;
}
const skip = url ? false : "set TEST_DATABASE_URL to run";

const { getPool, closePool } = await import("../lib/db.ts");
const { ensureStore } = await import("../lib/store.ts");
const { importProductsCsv, importCollectionsJson, importRedirectsCsv } = await import("../lib/import/run.ts");
const { applyStockUpdates } = await import("../lib/channel/inventory.ts");
const { createApiClient, authenticate, revokeApiClient } = await import("../lib/channel/keys.ts");
const { listChannelVariants } = await import("../lib/channel/products.ts");

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const productsCsv = fixture("products_export.csv");

after(async () => {
  if (!url) return;
  await getPool().query(`delete from stores where slug = $1`, [process.env.STORE_SLUG]);
  await closePool();
});

const stock = async (sku: string) =>
  (await getPool().query(`select inventory_quantity as q, inventory_source as s from product_variants where sku = $1 and store_id = $2`, [sku, await ensureStore()])).rows[0];

test("product CSV import, re-import and full-mode archiving", { skip }, async () => {
  const storeId = await ensureStore();
  const db = getPool();
  const first = await importProductsCsv(productsCsv, { mode: "partial", fileName: "products_export.csv" });
  assert.ok(first.ok, first.ok ? "" : first.error);
  assert.equal(first.stats.productsCreated, 3);
  assert.equal(first.stats.variantsCreated, 8);
  assert.equal(first.stats.stockFromCsv, 7, "draft has no qty column value");

  const p = (await db.query(
    `select title, status, published, min_price::text, options, metafields,
            (select count(*)::int from product_media m where m.product_id = products.id) as media
     from products where store_id = $1 and handle = 'black'`, [storeId])).rows[0];
  assert.equal(p.min_price, "995.00");
  assert.equal(p.media, 5);
  assert.equal(p.options.length, 3);
  assert.equal(p.metafields["gst_pro.hsn"], "61124990");
  assert.deepEqual(await stock("MBPS07-Wine-L"), { q: 0, s: "csv" });

  // Re-import with a changed price, a removed variant, and a new one.
  const edited = productsCsv
    .replace(/995\.00/g, "899.00")
    .replace(/\r\nblack,[^\r\n]*MBPS07-Wine-L[^\r\n]*/, "")
    .replace("MBPS07-Wine-M", "MBPS07-Wine-M2");
  const second = await importProductsCsv(edited, { mode: "partial" });
  assert.ok(second.ok, second.ok ? "" : second.error);
  assert.equal(second.stats.productsCreated, 0);
  // A new SKU is a new item to Browntape, even with the same options: Wine-M is replaced, not renamed.
  assert.equal(second.stats.variantsRemoved, 2, "Wine-L and Wine-M gone");
  assert.equal(second.stats.variantsCreated, 1, "Wine-M2 is new");
  assert.equal(second.stats.variantsUpdated, 6);
  assert.equal((await db.query(`select count(*)::int as n from product_variants where store_id = $1`, [storeId])).rows[0].n, 7);
  assert.equal((await db.query(`select min_price::text as m from products where store_id = $1 and handle = 'black'`, [storeId])).rows[0].m, "899.00");

  // Full mode: a file with only the cap archives the rest.
  const capOnly = productsCsv.split("\r\n").filter((l, i) => i === 0 || l.startsWith("classic-unisex")).join("\r\n");
  const third = await importProductsCsv(capOnly, { mode: "full" });
  assert.ok(third.ok);
  assert.equal(third.stats.productsArchived, 2);
  const statuses = (await db.query(`select handle, status from products where store_id = $1 order by handle`, [storeId])).rows;
  assert.deepEqual(statuses.map((r) => r.status), ["archived", "active", "archived"]);
  await importProductsCsv(productsCsv, { mode: "partial" }); // restore
});

test("a bad file changes nothing and is recorded as failed", { skip }, async () => {
  const storeId = await ensureStore();
  const before = (await getPool().query(`select count(*)::int as n from products where store_id = $1`, [storeId])).rows[0].n;
  const bad = await importProductsCsv("Name,Email\nx,y", { mode: "full", fileName: "wrong.csv" });
  assert.equal(bad.ok, false);
  const after = (await getPool().query(`select count(*)::int as n from products where store_id = $1`, [storeId])).rows[0].n;
  assert.equal(after, before);
  const run = (await getPool().query(`select status, file_name from import_runs where store_id = $1 order by started_at desc limit 1`, [storeId])).rows[0];
  assert.deepEqual(run, { status: "failed", file_name: "wrong.csv" });
});

test("collections import builds rule and manual memberships in order", { skip }, async () => {
  const storeId = await ensureStore();
  const result = await importCollectionsJson(JSON.parse(readFileSync(new URL("../data/megaska-collections.json", import.meta.url), "utf8")));
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.equal(result.stats.collections, 31);
  const members = async (handle: string) =>
    (await getPool().query(
      `select p.handle from collection_products cp join collections c on c.id = cp.collection_id
       join products p on p.id = cp.product_id where c.store_id = $1 and c.handle = $2 order by cp.position`,
      [storeId, handle],
    )).rows.map((r) => r.handle);
  assert.deepEqual(await members("best-sellers"), ["black"]);
  assert.deepEqual(await members("swim-caps"), ["classic-unisex-soft-silicone"], "manual list");
  // Membership includes drafts, as in Shopify; the storefront hides them when listing.
  assert.deepEqual(await members("under-499-store"), ["classic-unisex-soft-silicone", "draft-thing"]);
  assert.deepEqual(await members("all"), ["classic-unisex-soft-silicone", "black", "draft-thing"], "best-seller order, unranked last");
  // Rules keep working after a product import (cap retagged as swimwear).
  await importProductsCsv(productsCsv.replace('"swim cap"', '"swim cap, swimwear"').replace(",swim cap,", ',"swim cap, swimwear",'), { mode: "partial" });
  assert.ok((await members("swimwears")).includes("classic-unisex-soft-silicone"));
});

test("redirects import", { skip }, async () => {
  const r = await importRedirectsCsv(fixture("url_redirects.csv"));
  assert.ok(r.ok);
  assert.equal(r.stats.redirects, 3);
});

test("Browntape stock: first reading replaces CSV stock, newer wins, retries are harmless", { skip }, async () => {
  const storeId = await ensureStore();
  const push = (items: Array<{ sku: string; quantity: number; updatedAt?: string }>, requestId = "r") =>
    applyStockUpdates(storeId, items, { clientName: "Browntape", requestId });

  const first = await push([{ sku: "mbps07-black-s", quantity: 7 }, { sku: "NOPE", quantity: 1 }]);
  assert.deepEqual(first.results.map((r) => r.outcome), ["updated", "unknown_sku"], "SKU match ignores case");
  assert.deepEqual(first.tags, ["product:black"]);
  assert.deepEqual(await stock("MBPS07-Black-S"), { q: 7, s: "api:Browntape" });

  const same = await push([{ sku: "MBPS07-Black-S", quantity: 7 }]);
  assert.equal(same.results[0].outcome, "unchanged");
  assert.deepEqual(same.tags, []);

  const t = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  assert.equal((await push([{ sku: "MBPS07-Black-S", quantity: 3, updatedAt: t(10) }])).results[0].outcome, "updated");
  const late = await push([{ sku: "MBPS07-Black-S", quantity: 9, updatedAt: t(5) }]);
  assert.deepEqual(late.results[0], { sku: "MBPS07-Black-S", outcome: "stale", quantity: 3 });
  assert.equal((await stock("MBPS07-Black-S")).q, 3);

  // A later CSV import must not overwrite Browntape's stock, but still sets CSV-only SKUs.
  await importProductsCsv(productsCsv, { mode: "partial" });
  assert.equal((await stock("MBPS07-Black-S")).q, 3);
  assert.deepEqual(await stock("MBPS07-Black-M"), { q: 10, s: "csv" });

  const log = (await getPool().query(`select outcome from inventory_log where store_id = $1 order by id`, [storeId])).rows.map((r) => r.outcome);
  assert.deepEqual(log, ["updated", "unknown_sku", "unchanged", "updated", "stale"]);
});

test("concurrent pushes for one SKU: the newest reading wins", { skip }, async () => {
  const storeId = await ensureStore();
  const base = Date.now() + 3_600_000;
  const pushes = Array.from({ length: 12 }, (_, i) =>
    applyStockUpdates(storeId, [{ sku: "MSC01-Black", quantity: i, updatedAt: new Date(base + i * 1000).toISOString() }], { clientName: "Browntape", requestId: `c${i}` }),
  );
  await Promise.all(pushes);
  assert.equal((await stock("MSC01-Black")).q, 11);
});

test("API keys and the product feed", { skip }, async () => {
  const storeId = await ensureStore();
  const { key } = await createApiClient(storeId, "Browntape", ["inventory:write", "products:read"]);
  const client = await authenticate(`Bearer ${key}`);
  assert.equal(client?.name, "Browntape");
  assert.deepEqual(client?.scopes, ["inventory:write", "products:read"]);
  const tampered = key.slice(0, -1) + (key.endsWith("x") ? "y" : "x");
  assert.equal(await authenticate(`Bearer ${tampered}`), null);
  assert.equal(await authenticate(null), null);
  await revokeApiClient(storeId, client!.id);
  assert.equal(await authenticate(`Bearer ${key}`), null);

  const page1 = await listChannelVariants(storeId, { limit: 3 });
  assert.equal(page1.length, 3);
  const page2 = await listChannelVariants(storeId, { limit: 50, after: page1[2].sku });
  assert.equal(page1.length + page2.length, 8);
  const v = [...page1, ...page2].find((x) => x.sku === "MBPS07-Black-S")!;
  assert.deepEqual(v.options, { Color: "Black", Size: "S", Fabric: "Polyester-Spandex" });
  assert.equal(v.variant_title, "Black / S / Polyester-Spandex");
  assert.equal(v.mrp, "1899.00");
  assert.equal(v.hsn_code, "61124990");
  assert.equal(v.quantity, 3);
});
