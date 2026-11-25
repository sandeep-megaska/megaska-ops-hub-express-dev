const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** "995.00" -> "₹995". Prices are whole rupees on Megaska; paise are shown only when present. */
export function formatPrice(amount: string | null | undefined): string {
  if (!amount) return "";
  const value = Number(amount);
  if (!Number.isInteger(value)) {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value);
  }
  return inr.format(value);
}

export function discountPercent(price: string | null, compareAt: string | null): number | null {
  if (!price || !compareAt) return null;
  const p = Number(price);
  const c = Number(compareAt);
  if (!(c > p) || c <= 0) return null;
  return Math.round(((c - p) / c) * 100);
}

/**
 * Shopify CDN images resize on the fly with a `width` query parameter, so we
 * use them directly instead of paying for Vercel Image Optimization.
 */
export function shopifyImageUrl(url: string, width: number): string {
  try {
    const u = new URL(url);
    if (u.hostname === "cdn.shopify.com" || u.hostname.endsWith(".myshopify.com")) {
      u.searchParams.set("width", String(width));
      return u.toString();
    }
  } catch {
    // fall through
  }
  return url;
}

export function shopifySrcSet(url: string, widths: number[] = [360, 540, 720, 1080]): string {
  return widths.map((w) => `${shopifyImageUrl(url, w)} ${w}w`).join(", ");
}
