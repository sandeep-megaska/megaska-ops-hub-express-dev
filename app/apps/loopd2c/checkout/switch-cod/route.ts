import type { NextRequest } from "next/server";
import { verifyCodRecoveryToken } from "../../../../../services/checkout-recovery/prepaid-cod-recovery.ts";
import { requireShopFromAppProxy } from "../../../../../services/shopify/app-proxy";

export const dynamic = "force-dynamic";

// Opened from the prepaid -> COD recovery email through the Shopify app proxy.
// Served as `application/liquid` so it renders inside the storefront theme, with
// the LoopD2C app embed (cart drawer + OTP gate) loaded. The script rebuilds the
// abandoned cart, marks it Cash on Delivery and opens the drawer; checkout then
// goes through the normal OTP gate, so this link cannot skip phone verification.

function page(body: string, script = "") {
  return `<div class="page-width" style="padding:48px 16px;text-align:center;max-width:520px;margin:0 auto">${body}</div>${script}`;
}

function liquidResponse(html: string) {
  return new Response(html, { headers: { "content-type": "application/liquid; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

const EXPIRED = page(
  '<h1 style="font-size:22px;margin:0 0 12px">This link has expired</h1>' +
  '<p style="margin:0 0 20px;color:#555">Your bag may still have your items. You can choose Cash on Delivery from the bag.</p>' +
  '<a href="/" style="display:inline-block;padding:12px 22px;background:#111;color:#fff;border-radius:10px;text-decoration:none">Continue shopping</a>',
);

export async function GET(request: NextRequest) {
  let items: Array<{ variantId: number; quantity: number }>;
  try {
    const shop = await requireShopFromAppProxy(request);
    const verified = verifyCodRecoveryToken(request.nextUrl.searchParams.get("t") || "", { shopId: shop.id, now: new Date() });
    if (!verified) return liquidResponse(EXPIRED);
    items = verified.items;
  } catch {
    return liquidResponse(EXPIRED);
  }

  // Only numeric variant ids and quantities reach the script (validated when the
  // token is verified), so JSON.stringify output is safe to inline.
  const payload = JSON.stringify(items.map((item) => ({ id: item.variantId, quantity: item.quantity })));
  const script = `<script>
(function () {
  var items = ${payload};
  var status = document.getElementById("loopd2c-cod-status");
  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (response) { if (!response.ok) throw new Error(url); return response.json(); });
  }
  function openDrawer(attempt) {
    if (window.LoopDeskCartController && typeof window.LoopDeskCartController.open === "function") {
      window.LoopDeskCartController.open();
      if (status) status.textContent = "Your bag is ready. Tap Cash on Delivery to place your order.";
      return;
    }
    if (attempt > 40) { window.location.href = "/cart"; return; }
    setTimeout(function () { openDrawer(attempt + 1); }, 150);
  }
  post("/cart/clear.js")
    .then(function () { return post("/cart/add.js", { items: items }); })
    .then(function () { return post("/cart/update.js", { attributes: { loopd2c_payment_intent: "cod" } }); })
    .then(function () { openDrawer(0); })
    .catch(function () {
      if (status) status.textContent = "Some items may be out of stock. Please check your bag.";
      openDrawer(0);
    });
})();
</script>`;
  return liquidResponse(page(
    '<h1 style="font-size:22px;margin:0 0 12px">Pay on delivery</h1>' +
    '<p id="loopd2c-cod-status" style="margin:0;color:#555">Getting your bag ready…</p>',
    script,
  ));
}
