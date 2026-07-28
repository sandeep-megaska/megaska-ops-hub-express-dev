// No Preact, no JSX, no hooks - see gst-invoice-action for why:
// Preact's render() was reporting success with no errors while never
// actually mounting content in this environment. Plain DOM APIs instead.

async function fetchShopDomain() {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query: "{ shop { myshopifyDomain } }" }),
  });
  const json = await res.json().catch(() => null);
  return json?.data?.shop?.myshopifyDomain || "";
}

export default async () => {
  const { i18n, data } = shopify;

  const printAction = document.createElement("s-admin-print-action");

  const preparingText = document.createElement("s-text");
  preparingText.textContent = i18n.translate("preparing");
  printAction.appendChild(preparingText);

  document.body.appendChild(printAction);

  try {
    const shopDomain = await fetchShopDomain();
    const params = new URLSearchParams({
      orderId: data.selected[0].id,
      shop: shopDomain,
    });

    // A relative src resolves against this extension's sandbox origin
    // (extensions.shopifycdn.com), not our app, and a blob: URL does not render
    // in the print-action preview either (both showed "Preview unable to
    // load"). fetch() IS resolved against the app's application_url, so we fetch
    // the printable document first (to validate it and to learn the absolute
    // app URL Shopify resolved it to), then hand the print action that absolute
    // URL. Shopify loads it directly; the route already sends CORS for the
    // extension sandbox origin.
    const res = await fetch(`/api/gst/print/order?${params.toString()}`);
    if (!res.ok) {
      preparingText.textContent = `Unable to prepare GST invoice for printing (HTTP ${res.status}). Open the GST app to resolve any outstanding issues, then try again.`;
      return;
    }

    if (!res.url || !/^https?:\/\//i.test(res.url)) {
      preparingText.textContent = "Unable to prepare GST invoice for printing (could not resolve a printable document URL).";
      return;
    }

    printAction.src = res.url;
  } catch (error) {
    preparingText.textContent =
      error instanceof Error ? error.message : "Unable to prepare GST invoice for printing.";
  }
};
