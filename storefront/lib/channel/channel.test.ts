import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKey, parseKey } from "./keys.ts";
import { parseStockUpdates, ValidationError } from "./inventory.ts";

test("generated keys parse back to their prefix", () => {
  const { key, prefix, hash } = generateKey();
  assert.match(key, /^msk_[0-9a-f]{10}_[A-Za-z0-9_-]{32}$/);
  assert.equal(parseKey(key)?.prefix, prefix);
  assert.equal(hash.length, 64);
  assert.notEqual(generateKey().key, key);
  assert.equal(parseKey("msk_short_x"), null);
});

test("stock updates: valid body", () => {
  const items = parseStockUpdates({
    items: [
      { sku: " MBPS07-Black-S ", quantity: 4 },
      { sku: "MBPS07-Black-M", quantity: 0, updated_at: "2026-11-25T10:00:00+05:30" },
      { sku: "mbps07-black-s", quantity: 5 },
    ],
  });
  assert.deepEqual(items, [
    { sku: "mbps07-black-s", quantity: 5, updatedAt: undefined },
    { sku: "MBPS07-Black-M", quantity: 0, updatedAt: "2026-11-25T04:30:00.000Z" },
  ]);
});

test("stock updates: one bad item rejects the whole request", () => {
  const bad = (items: unknown[]) => () => parseStockUpdates({ items });
  assert.throws(bad([{ sku: "A", quantity: -1 }]), ValidationError);
  assert.throws(bad([{ sku: "A", quantity: 1.5 }]), ValidationError);
  assert.throws(bad([{ sku: "A", quantity: "3" }]), ValidationError);
  assert.throws(bad([{ sku: "", quantity: 1 }]), ValidationError);
  assert.throws(bad([{ sku: "A", quantity: 1, updated_at: "yesterday" }]), ValidationError);
  assert.throws(bad([]), ValidationError);
  assert.throws(() => parseStockUpdates({}), ValidationError);
  assert.throws(bad(Array.from({ length: 1001 }, (_, i) => ({ sku: `S${i}`, quantity: 1 }))), /At most 1000/);
  try {
    parseStockUpdates({ items: [{ sku: "A", quantity: 1 }, { sku: "B", quantity: -2 }] });
  } catch (e) {
    assert.deepEqual((e as ValidationError).details, ["items[1] (B): quantity must be a whole number from 0 to 1000000"]);
  }
});
