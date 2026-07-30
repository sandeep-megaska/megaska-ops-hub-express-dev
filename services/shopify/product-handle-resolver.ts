import { adminGraphql } from "./admin";
import { normalizeShopifyProductId } from "../reviews/shopify-product-id";

// Resolves Shopify product handles to their numeric product ids via the Admin
// GraphQL API, batched to keep the query string bounded. Handles are matched
// case-insensitively; a handle that matches no product is simply absent from the
// returned map (the caller treats it as unmatched). Best-effort: a GraphQL error
// on one chunk skips that chunk rather than failing the whole resolution.
const HANDLES_PER_QUERY = 25;

export async function resolveProductIdsByHandle(
  handles: string[],
  shopDomain: string,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const unique = [...new Set(handles.map((handle) => String(handle || "").trim().toLowerCase()).filter(Boolean))];
  if (unique.length === 0 || !String(shopDomain || "").trim()) return resolved;

  for (let offset = 0; offset < unique.length; offset += HANDLES_PER_QUERY) {
    const chunk = unique.slice(offset, offset + HANDLES_PER_QUERY);
    // Quote handles to be safe; strip any embedded single quotes first.
    const query = chunk.map((handle) => `handle:'${handle.replace(/'/g, "")}'`).join(" OR ");
    try {
      const data = await adminGraphql<{ products: { nodes: Array<{ id: string; handle: string }> } }>(
        `query ResolveProductHandles($query: String!) {
          products(first: 250, query: $query) {
            nodes { id handle }
          }
        }`,
        { query },
        { shopDomain },
      );
      for (const node of data.products?.nodes || []) {
        const id = normalizeShopifyProductId(node.id);
        const handle = String(node.handle || "").trim().toLowerCase();
        if (id && handle && !resolved.has(handle)) resolved.set(handle, id);
      }
    } catch {
      // Leave this chunk's handles unresolved; the import reports them as unmatched.
    }
  }

  return resolved;
}
