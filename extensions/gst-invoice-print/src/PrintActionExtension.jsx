import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

export default async () => {
  render(<Extension />, document.body);
};

async function fetchShopDomain() {
  const res = await fetch("shopify:admin/api/graphql.json", {
    method: "POST",
    body: JSON.stringify({ query: "{ shop { myshopifyDomain } }" }),
  });
  const json = await res.json().catch(() => null);
  return json?.data?.shop?.myshopifyDomain || "";
}

function Extension() {
  const { i18n, data } = shopify;
  const [src, setSrc] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const shopDomain = await fetchShopDomain();
      if (cancelled) return;
      const params = new URLSearchParams({
        orderId: data.selected[0].id,
        shop: shopDomain,
      });
      setSrc(`/api/gst/print/order?${params.toString()}`);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <s-admin-print-action src={src}>
      <s-text>{i18n.translate("preparing")}</s-text>
    </s-admin-print-action>
  );
}
