import { intParam, requestIdOf, requireClient } from "@/lib/channel/http.ts";
import { listChannelVariants } from "@/lib/channel/products.ts";

/** Catalog by SKU for mapping in Browntape. Page with ?after=<last sku>&limit= (max 500). */
export async function GET(request: Request) {
  const requestId = requestIdOf(request);
  const client = await requireClient(request, "products:read", requestId);
  if (client instanceof Response) return client;
  const url = new URL(request.url);
  const limit = intParam(url, "limit", 250, 500);
  const items = await listChannelVariants(client.storeId, { after: url.searchParams.get("after") ?? undefined, limit });
  const next = items.length === limit ? items[items.length - 1].sku : null;
  return Response.json({ items, next_after: next, request_id: requestId });
}
