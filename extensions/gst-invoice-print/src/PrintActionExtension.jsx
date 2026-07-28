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
    // (extensions.shopifycdn.com), not our app. fetch() IS resolved against the
    // app's application_url, but Response.url comes back empty in this runtime,
    // so we cannot learn the absolute URL from the response itself. Instead the
    // prepare step (format=json) validates/generates the invoice and returns the
    // absolute app URL that Shopify's print preview should load as src.
    const res = await fetch(`/api/gst/print/order?${params.toString()}&format=json`);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok || !json.url) {
      preparingText.textContent =
        (json && json.error) ||
        `Unable to prepare GST invoice for printing (HTTP ${res.status}). Open the GST app to resolve any outstanding issues, then try again.`;
      return;
    }

    if (!/^https?:\/\//i.test(json.url)) {
      preparingText.textContent = "Unable to prepare GST invoice for printing (could not resolve a printable document URL).";
      return;
    }

    // s-admin-print-action renders the document at `src` in its own preview and
    // takes no children. Set the attribute (the observed one) as well as the
    // property, and remove the "Preparing..." placeholder - otherwise it lingers
    // beside the loaded preview and the action looks like it never finished.
    printAction.setAttribute("src", json.url);
    printAction.src = json.url;
    preparingText.remove();
  } catch (error) {
    preparingText.textContent =
      error instanceof Error ? error.message : "Unable to prepare GST invoice for printing.";
  }
};
