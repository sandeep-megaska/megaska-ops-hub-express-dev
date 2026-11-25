import { getPool } from "../db.ts";
import { syncProduct, deleteProduct } from "./products.ts";
import { syncCollection, deleteCollection } from "./collections.ts";
import { applyInventoryLevel } from "./inventory.ts";

export type WebhookOutcome = { status: "processed" | "ignored" | "duplicate"; tags: string[]; resourceId?: string };

type Payload = {
  id?: number | string;
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
  updated_at?: string;
};

/** The resource a webhook is about, as a numeric Shopify ID string. */
export function webhookResourceId(topic: string, payload: Payload): string | undefined {
  const raw = topic.startsWith("inventory_levels/") ? payload.inventory_item_id : payload.id;
  if (raw === undefined || raw === null) return undefined;
  const id = String(raw);
  return /^\d+$/.test(id) ? id : undefined;
}

/**
 * Record and apply one webhook delivery. Shopify retries until it gets a
 * 2xx, and can deliver the same event twice: the webhook_events unique key
 * turns repeats into no-ops. We always refetch from the Admin API rather than
 * trusting the payload, so out-of-order deliveries still end in the latest state.
 */
export async function handleWebhook(
  storeId: string,
  delivery: { webhookId: string; topic: string; payload: Payload },
): Promise<WebhookOutcome> {
  const { webhookId, topic, payload } = delivery;
  const resourceId = webhookResourceId(topic, payload);

  const inserted = await getPool().query<{ id: string; status: string }>(
    `insert into webhook_events (store_id, webhook_id, topic, resource_id)
     values ($1, $2, $3, $4)
     on conflict (store_id, webhook_id) do update set received_at = webhook_events.received_at
     returning id, status`,
    [storeId, webhookId, topic, resourceId ?? null],
  );
  const event = inserted.rows[0];
  if (event.status === "processed" || event.status === "ignored") {
    return { status: "duplicate", tags: [], resourceId };
  }

  try {
    let tags: string[] | null = null;
    if (resourceId) {
      switch (topic) {
        case "products/create":
        case "products/update":
          tags = await syncProduct(storeId, resourceId);
          break;
        case "products/delete":
          tags = await deleteProduct(storeId, resourceId);
          break;
        case "collections/create":
        case "collections/update":
          tags = await syncCollection(storeId, resourceId);
          break;
        case "collections/delete":
          tags = await deleteCollection(storeId, resourceId);
          break;
        case "inventory_levels/update":
          tags = await applyInventoryLevel(storeId, {
            inventory_item_id: resourceId,
            available: payload.available,
            updated_at: payload.updated_at,
          });
          break;
      }
    }
    const status = tags === null ? "ignored" : "processed";
    await getPool().query(
      `update webhook_events set status = $2, processed_at = now(), error = null where id = $1`,
      [event.id, status],
    );
    return { status, tags: tags ?? [], resourceId };
  } catch (error) {
    await getPool().query(
      `update webhook_events set status = 'failed', error = $2 where id = $1`,
      [event.id, error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }
}
