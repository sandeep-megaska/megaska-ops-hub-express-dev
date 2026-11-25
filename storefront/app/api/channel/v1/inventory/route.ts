import { revalidateTag } from "next/cache";
import { apiError, intParam, requestIdOf, requireClient } from "@/lib/channel/http.ts";
import { applyStockUpdates, parseStockUpdates, readStock, ValidationError } from "@/lib/channel/inventory.ts";

export const maxDuration = 30;

/** Set absolute stock levels by SKU. See docs/channel-api.md. */
export async function POST(request: Request) {
  const requestId = requestIdOf(request);
  const client = await requireClient(request, "inventory:write", requestId);
  if (client instanceof Response) return client;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_json", "Body must be JSON", requestId);
  }
  try {
    const updates = parseStockUpdates(body);
    const { results, tags } = await applyStockUpdates(client.storeId, updates, { clientName: client.name, requestId });
    // Product pages show stock (sold out / available), so refresh them now.
    for (const tag of tags) revalidateTag(tag, { expire: 0 });
    const summary = results.reduce<Record<string, number>>((acc, r) => ({ ...acc, [r.outcome]: (acc[r.outcome] ?? 0) + 1 }), {});
    return Response.json({ ok: true, summary, results, request_id: requestId }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof ValidationError) return apiError(422, "validation_failed", error.message, requestId, error.details);
    console.error("[channel] inventory update failed", { requestId, error });
    return apiError(500, "internal_error", "Could not apply the update; nothing was changed. Retry is safe.", requestId);
  }
}

/** Read stock: ?sku=A,B,C for specific SKUs, or page through all with ?after=<last sku>&limit=. */
export async function GET(request: Request) {
  const requestId = requestIdOf(request);
  const client = await requireClient(request, "inventory:read", requestId);
  if (client instanceof Response) return client;
  const url = new URL(request.url);
  const skus = url.searchParams.get("sku")?.split(",").map((s) => s.trim()).filter(Boolean);
  const limit = intParam(url, "limit", 500, 1000);
  const items = await readStock(client.storeId, { skus, after: url.searchParams.get("after") ?? undefined, limit });
  const next = !skus && items.length === limit ? items[items.length - 1].sku : null;
  return Response.json({ items, next_after: next, request_id: requestId });
}
