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

  const shopDomain = await fetchShopDomain();
  const params = new URLSearchParams({
    orderId: data.selected[0].id,
    shop: shopDomain,
  });
  printAction.src = `/api/gst/print/order?${params.toString()}`;
};
