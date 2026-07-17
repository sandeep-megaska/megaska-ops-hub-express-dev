import { headers } from "next/headers";
import { getReviewSettings } from "../../../services/reviews/review-settings";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";
import ReviewDisplaySettingsClient from "./ReviewDisplaySettingsClient";
import ReviewModerationClient from "./ReviewModerationClient";

export default async function AdminReviewsPage() {
  const headerStore = await headers();
  const domain = normalizeShopDomain(headerStore.get("x-shopify-shop-domain") || "");
  const shop = domain ? await getShopByDomain(domain) : await resolveShopConfig();
  if (!shop?.id) return <main className="mk-page"><p className="mk-card">Shop context is unavailable. Open this page from embedded admin for a specific shop.</p></main>;
  const settings = await getReviewSettings(shop.id);
  return <><ReviewModerationClient shop={shop.shopDomain} reviewsEnabled={settings.reviewsEnabled}/><div id="review-settings"><ReviewDisplaySettingsClient initial={settings}/></div></>;
}
