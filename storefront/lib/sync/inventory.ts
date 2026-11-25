import { getPool } from "../db.ts";
import { env } from "../env.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId, toGid } from "../shopify/map.ts";
import { INVENTORY_ITEM_QUERY } from "../shopify/queries.ts";
import { productTag } from "../catalog/tags.ts";

// Megaska's stock is managed in Browntape, which pushes it into Shopify.
// Each push fires inventory_levels/update webhooks, sometimes hundreds at
// once. Shopify allows a webhook 5 seconds, so these are applied straight
// from the payload with no Admin API call.

export type InventoryLevelPayload = {
  inventory_item_id: string;
  location_id?: number | string;
  available?: number | null;
  updated_at?: string;
};

/**
 * Apply an inventory_levels/update webhook. Returns stale cache tags.
 *
 * With one stock location (Jaipur-1 today), the level's `available` is the
 * variant's total. Set SHOPIFY_MULTI_LOCATION=true if a second location is
 * added: totals are then reread from Shopify instead.
 */
export async function applyInventoryLevel(storeId: string, payload: InventoryLevelPayload): Promise<string[]> {
  const updatedAt = payload.updated_at ? new Date(payload.updated_at) : null;
  const usable =
    !env.multiLocation() &&
    typeof payload.available === "number" &&
    updatedAt !== null && !Number.isNaN(updatedAt.getTime());
  if (!usable) return syncInventoryItem(storeId, payload.inventory_item_id);

  // The guard drops a delivery older than what we already hold (retries and
  // out-of-order deliveries are normal during a bulk push).
  const { rows } = await getPool().query<{ handle: string }>(
    `update product_variants v
     set inventory_quantity = $3, inventory_updated_at = $4, synced_at = now()
     from products p
     where v.store_id = $1 and v.inventory_item_id = $2 and p.id = v.product_id
       and v.inventory_updated_at < $4
     returning p.handle`,
    [storeId, payload.inventory_item_id, payload.available, updatedAt],
  );
  return [...new Set(rows.map((r) => productTag(r.handle)))];
}

type InventoryItemResult = {
  inventoryItem: {
    id: string;
    tracked: boolean;
    variants: { nodes: Array<{ id: string; inventoryQuantity: number | null; product: { id: string } }> };
  } | null;
};

/** Reread a variant's total stock from Shopify (all locations). */
export async function syncInventoryItem(storeId: string, inventoryItemId: string): Promise<string[]> {
  const fetchedAt = new Date();
  const data = await adminGraphql<InventoryItemResult>(INVENTORY_ITEM_QUERY, {
    id: toGid("InventoryItem", inventoryItemId),
  });
  const item = data.inventoryItem;
  if (!item) return [];

  const tags = new Set<string>();
  for (const variant of item.variants.nodes) {
    const { rows } = await getPool().query<{ handle: string }>(
      `update product_variants v
       set inventory_quantity = $3, inventory_tracked = $4, inventory_updated_at = $5, synced_at = now()
       from products p
       where v.store_id = $1 and v.shopify_id = $2 and p.id = v.product_id
         and v.inventory_updated_at < $5
       returning p.handle`,
      [storeId, legacyId(variant.id), variant.inventoryQuantity ?? 0, item.tracked, fetchedAt],
    );
    for (const row of rows) tags.add(productTag(row.handle));
  }
  return [...tags];
}
