import { getReviewSettings } from "../../../services/reviews/review-settings";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import ReviewDisplaySettingsClient from "./ReviewDisplaySettingsClient";
import ReviewModerationClient from "./ReviewModerationClient";
import ReviewImportExportClient from "./ReviewImportExportClient";
export default async function AdminReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }){const params=await searchParams;const resolved=await resolveAdminShopFromSearchParams(params);const shop=resolved.shop;if(!shop?.id)return <main style={{padding:24}}>{formatAdminShopResolutionError(resolved)}</main>;const settings = await getReviewSettings(shop.id);

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
  reviewSectionHeading: settings.reviewSectionHeading, reviewEmptyStateText: settings.reviewEmptyStateText, reviewVerifiedPurchaseText: settings.reviewVerifiedPurchaseText, reviewLoadMoreText: settings.reviewLoadMoreText, reviewWriteReviewText: settings.reviewWriteReviewText, reviewCountTextTemplate: settings.reviewCountTextTemplate,
  reviewAccentColor: settings.reviewAccentColor, reviewStarColor: settings.reviewStarColor, reviewHeadingColor: settings.reviewHeadingColor, reviewTextColor: settings.reviewTextColor, reviewMutedTextColor: settings.reviewMutedTextColor, reviewBorderColor: settings.reviewBorderColor, reviewBackgroundColor: settings.reviewBackgroundColor, reviewButtonBackgroundColor: settings.reviewButtonBackgroundColor, reviewButtonTextColor: settings.reviewButtonTextColor,
  reviewAlignment: settings.reviewAlignment, reviewCardStyle: settings.reviewCardStyle, reviewCornerRadius: settings.reviewCornerRadius, reviewSectionSpacing: settings.reviewSectionSpacing, showReviewSectionHeading: settings.showReviewSectionHeading, showWriteReviewButton: settings.showWriteReviewButton,
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

    <ReviewImportExportClient shop={shop.shopDomain} />
    <ReviewDisplaySettingsClient initial={displaySettings} />
    <ReviewModerationClient shop={shop.shopDomain} />
  </>
);}
