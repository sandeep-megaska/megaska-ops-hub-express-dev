import { headers } from "next/headers";
import { getReviewSettings } from "../../../services/reviews/review-settings";
import { getShopByDomain, normalizeShopDomain, resolveShopConfig } from "../../../services/shopify/shop";
import ReviewDisplaySettingsClient from "./ReviewDisplaySettingsClient";
import ReviewModerationClient from "./ReviewModerationClient";
export default async function AdminReviewsPage(){const headerStore=await headers();const domain=normalizeShopDomain(headerStore.get("x-shopify-shop-domain")||"");const shop=domain?await getShopByDomain(domain):await resolveShopConfig();if(!shop?.id)return <main style={{padding:24}}>Shop context is unavailable. Open this page from embedded admin for a specific shop.</main>;const settings = await getReviewSettings(shop.id);

const displaySettings = {
  reviewsEnabled: settings.reviewsEnabled,
  automaticRequestsEnabled: settings.automaticRequestsEnabled,
  storefrontReviewsEnabled: settings.storefrontReviewsEnabled,
  showReviewSummary: settings.showReviewSummary,
  showRatingDistribution: settings.showRatingDistribution,
  showVerifiedPurchaseBadge: settings.showVerifiedPurchaseBadge,
  showReviewDates: settings.showReviewDates,
  showVariantTitle: settings.showVariantTitle,
  reviewsPerPage: settings.reviewsPerPage,
  defaultReviewSort: settings.defaultReviewSort,
};

return (
  <>
    <>
      {!settings.reviewsEnabled && (
        <p style={{ margin: 24 }}>
          New review collection is disabled. Existing reviews remain available
          for moderation and can still appear on the storefront if storefront
          display is enabled.
        </p>
      )}

      {!settings.storefrontReviewsEnabled && (
        <p style={{ margin: 24 }}>
          Published reviews are hidden from the storefront.
        </p>
      )}
    </>

    <ReviewDisplaySettingsClient initial={displaySettings} />
    <ReviewModerationClient shop={shop.shopDomain} />
  </>
);
