import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import ShipmentsClient from "./ShipmentsClient";

export default async function AdminShipmentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
          <h1 className="mk-page-title">Shipments</h1>
          <p className="mk-page-subtitle">
            Pick unfulfilled orders by date or order number and book them on Delhivery in one go.
          </p>
        </div>
      </div>
      <ShipmentsClient />
    </div>
  );
}
