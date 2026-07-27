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

    // Setting printAction.src to a relative path resolves it against this
    // extension's sandboxed origin (extensions.shopifycdn.com), not our app -
    // the same relative-URL trap documented in gst-invoice-action - so the
    // preview requests a URL that doesn't exist and shows "Preview unable to
    // load". fetch() is what Shopify resolves against the app's application_url
    // (and authenticates), so we fetch the printable document here and hand the
    // print action a self-contained blob URL instead of a relative path.
    const res = await fetch(`/api/gst/print/order?${params.toString()}`);
    if (!res.ok) {
      preparingText.textContent = `Unable to prepare GST invoice for printing (HTTP ${res.status}). Open the GST app to resolve any outstanding issues, then try again.`;
      return;
    }

    const html = await res.text();
    const blob = new Blob([html], { type: "text/html" });
    printAction.src = URL.createObjectURL(blob);
  } catch (error) {
    preparingText.textContent =
      error instanceof Error ? error.message : "Unable to prepare GST invoice for printing.";
  }
};
