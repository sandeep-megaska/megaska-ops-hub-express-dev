import { headers } from "next/headers";
import CheckoutAnalyticsClient from "./CheckoutAnalyticsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CheckoutAnalyticsPage() {
  const h = await headers();
  const shop = h.get("x-shopify-shop-domain") || "";
  return (
    <main className="mk-main">
      <CheckoutAnalyticsClient shop={shop} />
    </main>
  );
}
