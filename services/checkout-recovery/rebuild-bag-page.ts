// Storefront page (served through the Shopify app proxy as `application/liquid`,
// so it renders inside the theme with the LoopD2C app embed loaded) that
// rebuilds an abandoned bag and opens the cart drawer. Checkout then goes
// through the normal OTP gate, so these links cannot skip phone verification.
//
// "cod"  — marks the bag Cash on Delivery (prepaid -> COD recovery email).
// "bag"  — leaves the payment choice to the shopper (WhatsApp recovery), so the
//          drawer shows both Pay online (with the prepaid offer) and COD.

export type RebuildMode = "cod" | "bag";

function page(body: string, script = "") {
  return `<div class="page-width" style="padding:48px 16px;text-align:center;max-width:520px;margin:0 auto">${body}</div>${script}`;
}

export function liquidResponse(html: string) {
  return new Response(html, { headers: { "content-type": "application/liquid; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

export function expiredPage(mode: RebuildMode) {
  const hint = mode === "cod" ? "You can choose Cash on Delivery from the bag." : "You can pick up where you left off from the bag.";
  return page(
    '<h1 style="font-size:22px;margin:0 0 12px">This link has expired</h1>' +
    `<p style="margin:0 0 20px;color:#555">Your bag may still have your items. ${hint}</p>` +
    '<a href="/" style="display:inline-block;padding:12px 22px;background:#111;color:#fff;border-radius:10px;text-decoration:none">Continue shopping</a>',
  );
}

export function rebuildBagPage(items: Array<{ variantId: number; quantity: number }>, mode: RebuildMode) {
  // Only numeric variant ids and quantities reach the script (validated when the
  // token is verified), so JSON.stringify output is safe to inline.
  const payload = JSON.stringify(items.map((item) => ({ id: item.variantId, quantity: item.quantity })));
  const intent = mode === "cod" ? "cod" : "";
  const ready = mode === "cod" ? "Your bag is ready. Tap Cash on Delivery to place your order." : "Your bag is ready. Choose Pay online or Cash on Delivery to place your order.";
  const script = `<script>
(function () {
  var items = ${payload};
  var status = document.getElementById("loopd2c-bag-status");
  function post(url, body) {
    return fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (response) { if (!response.ok) throw new Error(url); return response.json(); });
  }
  function openDrawer(attempt) {
    if (window.LoopDeskCartController && typeof window.LoopDeskCartController.open === "function") {
      window.LoopDeskCartController.open();
      if (status) status.textContent = ${JSON.stringify(ready)};
      return;
    }
    if (attempt > 40) { window.location.href = "/cart"; return; }
    setTimeout(function () { openDrawer(attempt + 1); }, 150);
  }
  post("/cart/clear.js")
    .then(function () { return post("/cart/add.js", { items: items }); })
    .then(function () { return post("/cart/update.js", { attributes: { loopd2c_payment_intent: ${JSON.stringify(intent)} } }); })
    .then(function () { openDrawer(0); })
    .catch(function () {
      if (status) status.textContent = "Some items may be out of stock. Please check your bag.";
      openDrawer(0);
    });
})();
</script>`;
  const heading = mode === "cod" ? "Pay on delivery" : "Your Megaska bag";
  return page(
    `<h1 style="font-size:22px;margin:0 0 12px">${heading}</h1>` +
    '<p id="loopd2c-bag-status" style="margin:0;color:#555">Getting your bag ready…</p>',
    script,
  );
}
