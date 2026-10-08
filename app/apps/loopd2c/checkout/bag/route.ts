import type { NextRequest } from "next/server";
import { verifyCodRecoveryToken } from "../../../../../services/checkout-recovery/prepaid-cod-recovery.ts";
import { expiredPage, liquidResponse, rebuildBagPage } from "../../../../../services/checkout-recovery/rebuild-bag-page.ts";
import { requireShopFromAppProxy } from "../../../../../services/shopify/app-proxy";

export const dynamic = "force-dynamic";

// Opened from the WhatsApp recovery message button, or the "your bag is ready"
// link sent for a WhatsApp catalog cart: rebuilds the bag and opens the drawer
// with both payment options (see rebuild-bag-page.ts).
export async function GET(request: NextRequest) {
  try {
    const shop = await requireShopFromAppProxy(request);
    const verified = verifyCodRecoveryToken(request.nextUrl.searchParams.get("t") || "", { shopId: shop.id, now: new Date() });
    if (!verified) return liquidResponse(expiredPage("bag"));
    // Bags built from a WhatsApp catalog cart are tagged so their orders can be counted.
    return liquidResponse(rebuildBagPage(verified.items, "bag", verified.checkoutId.startsWith("wa:") ? { source: "whatsapp_cart" } : {}));
  } catch {
    return liquidResponse(expiredPage("bag"));
  }
}
