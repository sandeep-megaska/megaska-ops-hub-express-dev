import { headers } from "next/headers";
import { getReviewSettings } from "../../../services/reviews/review-settings";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";
import ReviewDisplaySettingsClient from "./ReviewDisplaySettingsClient";
import ReviewModerationClient from "./ReviewModerationClient";
export default async function AdminReviewsPage(){const headerStore=await headers();const domain=normalizeShopDomain(headerStore.get("x-shopify-shop-domain")||"");const shop=domain?await getShopByDomain(domain):await resolveShopConfig();if(!shop?.id)return <main style={{padding:24}}>Shop context is unavailable. Open this page from embedded admin for a specific shop.</main>;const settings=await getReviewSettings(shop.id);return <><>{!settings.reviewsEnabled&&<p style={{margin:24}}>New review collection is disabled. Historical reviews remain available for moderation.</p>}</><ReviewDisplaySettingsClient initial={settings}/><ReviewModerationClient shop={shop.shopDomain} reviewsEnabled={settings.reviewsEnabled}/></>}
