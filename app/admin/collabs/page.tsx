import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import CollabsClient from "./CollabsClient";

export default async function AdminCollabsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const resolved = await resolveAdminShopFromSearchParams(await searchParams);
  if (!resolved.shop?.id) {
    return (
      <div className="mk-page">
        <div className="mk-alert mk-alert-error">{formatAdminShopResolutionError(resolved)}</div>
      </div>
    );
  }

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Free parcels</h1>
          <p className="mk-page-subtitle">
            Send free products (influencers, collabs, PR, samples to vendors and manufacturers, photoshoots, gifts) from here
            instead of the Delhivery panel: stock goes down in Shopify, the parcel is tracked, and its value, cost and shipping
            are kept for your accounts.
          </p>
        </div>
      </div>
      <CollabsClient />
    </div>
  );
}
