// Cache tags shared by the cached catalog reads and the sync code that
// invalidates them. Every cached read also carries CATALOG_TAG, so a full
// sync can refresh everything with one call.

export const CATALOG_TAG = "catalog";
export const productTag = (handle: string) => `product:${handle}`;
export const collectionTag = (handle: string) => `collection:${handle}`;
export const REDIRECTS_TAG = "redirects";
