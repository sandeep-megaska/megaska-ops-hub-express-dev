import { getPool } from "../db.ts";
import { adminGraphql } from "../shopify/admin.ts";
import { legacyId, toGid } from "../shopify/map.ts";
import { INVENTORY_ITEM_QUERY } from "../shopify/queries.ts";
import { productTag } from "../catalog/tags.ts";

type InventoryItemResult = {
  inventoryItem: {
    id: string;
    tracked: boolean;
    variants: { nodes: Array<{ id: string; inventoryQuantity: number | null; product: { id: string } }> };
  } | null;
};

/**
 * Refresh a variant's stock after an inventory_levels/update webhook. We read
 * the variant's total from Shopify instead of trusting the webhook's
 * single-location number, so this stays right with more than one location.
 */
export async function syncInventoryItem(storeId: string, inventoryItemId: string): Promise<string[]> {
  const data = await adminGraphql<InventoryItemResult>(INVENTORY_ITEM_QUERY, {
    id: toGid("InventoryItem", inventoryItemId),
  });
  const item = data.inventoryItem;
  if (!item) return [];

  const tags = new Set<string>();
  for (const variant of item.variants.nodes) {
    const { rows } = await getPool().query<{ handle: string }>(
      `update product_variants v
       set inventory_quantity = $3, inventory_tracked = $4, synced_at = now()
       from products p
       where v.store_id = $1 and v.shopify_id = $2 and p.id = v.product_id
       returning p.handle`,
      [storeId, legacyId(variant.id), variant.inventoryQuantity ?? 0, item.tracked],
    );
    for (const row of rows) tags.add(productTag(row.handle));
  }
  return [...tags];
}
