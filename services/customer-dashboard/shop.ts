import type { DashboardShopDto } from "./contract.ts";
import type { DashboardCommerceSnapshot } from "./commerce.ts";
import type { CustomerDashboardContext } from "./context.ts";
export function buildDashboardShopDto(input: { context: CustomerDashboardContext; commerce?: DashboardCommerceSnapshot | null; currency?: string | null }): DashboardShopDto {
  const currency = input.currency || input.commerce?.recentOrders[0]?.currency || "INR";
  return { id: input.context.shopId, domain: input.context.shopDomain, name: null, currency, support: { email: null, phone: null, whatsapp: null, contactUrl: null }, branding: { accountLabel: "My Account", logoUrl: null } };
}
