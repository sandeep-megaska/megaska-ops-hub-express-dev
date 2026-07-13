import type { DashboardCustomerDto } from "./contract.ts";
import type { CustomerDashboardContext } from "./context.ts";
import { CustomerDashboardError } from "./errors.ts";

type CustomerProfileRecord = {
  id: string; shopId?: string | null; firstName?: string | null; lastName?: string | null; phoneE164?: string | null; phoneVerifiedAt?: Date | null; email?: string | null; shopifyCustomerId?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null; stateProvince?: string | null; postalCode?: string | null; countryRegion?: string | null;
} | null;

type CustomerDependencies = {
  customerProfile: { findFirst: (args: unknown) => Promise<CustomerProfileRecord>; update: (args: unknown) => Promise<unknown> };
  isShopifyAdminConfigured: () => boolean | Promise<boolean>;
  findShopifyCustomerIdByIdentity: (input: { shopDomain?: string | null; email?: string | null; phoneE164?: string | null }) => Promise<string | null>;
  logger: Pick<Console, "info" | "warn">;
};

const defaultDependencies: CustomerDependencies = {
  customerProfile: {
    findFirst: async (args) => { const mod = await import("../db/prisma.ts"); return mod.prisma.customerProfile.findFirst(args as never) as Promise<CustomerProfileRecord>; },
    update: async (args) => { const mod = await import("../db/prisma.ts"); return mod.prisma.customerProfile.update(args as never); },
  },
  isShopifyAdminConfigured: async () => { const mod = await import("../shopify/admin.ts"); return mod.isShopifyAdminConfigured(); },
  findShopifyCustomerIdByIdentity: async (input) => { const mod = await import("../shopify/admin.ts"); return mod.findShopifyCustomerIdByIdentity(input); },
  logger: console,
};

let dependencies: CustomerDependencies = defaultDependencies;

export type DashboardCustomerIdentity = {
  customerProfileId: string; shopId: string; shopDomain: string; firstName: string | null; lastName: string | null; phoneE164: string; phoneVerifiedAt: Date | null; email: string | null; shopifyCustomerId: string | null;
  address: { line1: string | null; line2: string | null; city: string | null; stateProvince: string | null; postalCode: string | null; countryRegion: string | null };
};

export function setDashboardCustomerDependenciesForTest(overrides: Partial<CustomerDependencies>) { dependencies = { ...dependencies, ...overrides }; }
export function resetDashboardCustomerDependenciesForTest() { dependencies = defaultDependencies; }

function clean(value: string | null | undefined) { const trimmed = String(value || "").trim(); return trimmed || null; }

export async function resolveDashboardCustomerIdentity(context: CustomerDashboardContext): Promise<DashboardCustomerIdentity> {
  const profile = await dependencies.customerProfile.findFirst({ where: { id: context.customerProfileId, OR: [{ shopId: context.shopId }, { shopId: null }] } });
  if (!profile || (profile.shopId && profile.shopId !== context.shopId)) {
    throw new CustomerDashboardError({ code: "CUSTOMER_NOT_FOUND", message: "Customer profile was not found.", status: 404 });
  }

  let shopifyCustomerId = clean(profile.shopifyCustomerId);
  try {
    if (await dependencies.isShopifyAdminConfigured()) {
      const email = clean(profile.email);
      const phoneE164 = clean(profile.phoneE164);
      const emailMatch = email ? clean(await dependencies.findShopifyCustomerIdByIdentity({ shopDomain: context.shopDomain, email })) : null;
      const phoneMatch = !emailMatch && phoneE164 ? clean(await dependencies.findShopifyCustomerIdByIdentity({ shopDomain: context.shopDomain, phoneE164 })) : null;
      const bestMatch = emailMatch || phoneMatch;
      if (bestMatch && bestMatch !== shopifyCustomerId) {
        await dependencies.customerProfile.update({ where: { id: profile.id }, data: { shopifyCustomerId: bestMatch } });
        shopifyCustomerId = bestMatch;
      }
      dependencies.logger.info("[CUSTOMER DASHBOARD] Shopify identity reconciliation complete", { shopId: context.shopId, customerProfileId: profile.id, matched: Boolean(bestMatch), matchSource: emailMatch ? "email" : phoneMatch ? "phone" : "none" });
    }
  } catch (error) {
    dependencies.logger.warn("[CUSTOMER DASHBOARD] Shopify identity reconciliation failed", { shopId: context.shopId, customerProfileId: profile.id, error: error instanceof Error ? error.message : String(error) });
  }

  return { customerProfileId: profile.id, shopId: context.shopId, shopDomain: context.shopDomain, firstName: clean(profile.firstName), lastName: clean(profile.lastName), phoneE164: clean(profile.phoneE164) || "", phoneVerifiedAt: profile.phoneVerifiedAt || null, email: clean(profile.email), shopifyCustomerId, address: { line1: clean(profile.addressLine1), line2: clean(profile.addressLine2), city: clean(profile.city), stateProvince: clean(profile.stateProvince), postalCode: clean(profile.postalCode), countryRegion: clean(profile.countryRegion) } };
}

export function buildDashboardCustomerDto(identity: DashboardCustomerIdentity, commerceEmail?: string | null): DashboardCustomerDto {
  const names = [identity.firstName, identity.lastName].map(clean).filter(Boolean) as string[];
  const displayName = names.join(" ") || identity.phoneE164 || "My Account";
  const initials = names.map((name) => name[0]).join("").slice(0, 2).toUpperCase() || displayName[0]?.toUpperCase() || "A";
  return { id: identity.customerProfileId, firstName: identity.firstName, lastName: identity.lastName, displayName, initials, phone: identity.phoneE164, phoneVerified: Boolean(identity.phoneVerifiedAt), email: clean(commerceEmail) || identity.email, shopifyCustomerId: identity.shopifyCustomerId };
}
