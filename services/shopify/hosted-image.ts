// True only for images in a store's own Shopify Files (cdn.shopify.com/s/files/...).
// Merchant logos are upload-only: storefront and invoice code never loads images from
// other hosts. No imports, so any module can use it.
export function isShopifyHostedImageUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === "cdn.shopify.com" && parsed.pathname.startsWith("/s/files/");
  } catch {
    return false;
  }
}
