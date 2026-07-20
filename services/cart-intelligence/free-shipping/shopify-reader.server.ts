import { shopifyAdminGraphql } from "../../shopify/admin";
import { resolveShopifyFreeShipping } from "./resolver";
import type { ShopifyFreeShippingAudit, ShopifyFreeShippingCandidate } from "./types";

export const DELIVERY_PROFILES_QUERY = `
  query LoopDeskFreeShippingProfiles {
    shop { currencyCode }
    deliveryProfiles(first: 25) {
      nodes {
        id name
        profileLocationGroups {
          locationGroupZones(first: 25) {
            nodes {
              zone { id name }
              methodDefinitions(first: 50) {
                nodes {
                  id active name
                  rateProvider {
                    __typename
                    ... on DeliveryRateDefinition { price { amount currencyCode } }
                  }
                  methodConditions {
                    field operator
                    conditionCriteria {
                      __typename
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const nodes = (value: unknown) => Array.isArray(record(value).nodes) ? record(value).nodes as unknown[] : [];

export async function readShopifyFreeShipping(input: { shopDomain: string; cartCurrency?: string; graphql?: typeof shopifyAdminGraphql }): Promise<ShopifyFreeShippingAudit> {
  try {
    const data = await (input.graphql || shopifyAdminGraphql)<RecordValue>(DELIVERY_PROFILES_QUERY, {}, { shopDomain: input.shopDomain });
    const profiles = nodes(record(data).deliveryProfiles);
    const cartCurrency = input.cartCurrency || String(record(record(data).shop).currencyCode || "");
    if (!record(data).deliveryProfiles || !Array.isArray(record(record(data).deliveryProfiles).nodes) || !cartCurrency) return resolveShopifyFreeShipping({ candidates: [], profileCount: 0, cartCurrency, malformed: true });
    const candidates: ShopifyFreeShippingCandidate[] = [];
    for (const rawProfile of profiles) {
      const profile = record(rawProfile);
      const groups = Array.isArray(profile.profileLocationGroups) ? profile.profileLocationGroups : [];
      const zones = groups.flatMap((group) => nodes(record(group).locationGroupZones));
      for (const rawZone of zones) for (const rawMethod of nodes(record(rawZone).methodDefinitions)) {
        const method = record(rawMethod); const provider = record(method.rateProvider); const price = record(provider.price);
        const conditions = Array.isArray(method.methodConditions) ? method.methodConditions.map(record) : [];
        const subtotal = conditions.find((condition) => String(condition.field || "").toUpperCase().includes("PRICE"));
        const criteria = record(subtotal?.conditionCriteria);
        const unsupported = conditions.find((condition) => !String(condition.field || "").toUpperCase().includes("PRICE"));
        candidates.push({ profileId: String(profile.id || ""), profileName: String(profile.name || "Unnamed profile"), broadlyApplicable: profiles.length === 1, zoneCount: zones.length, active: method.active === true, providerType: String(provider.__typename || "").includes("Participant") ? "CARRIER" : String(provider.__typename || "").includes("RateDefinition") ? "MERCHANT" : "UNKNOWN", priceAmount: typeof price.amount === "string" ? price.amount : null, priceCurrency: typeof price.currencyCode === "string" ? price.currencyCode : null, conditionType: unsupported ? (String(unsupported.field || "").toUpperCase().includes("WEIGHT") ? "WEIGHT" : "UNSUPPORTED") : subtotal ? "MINIMUM_SUBTOTAL" : null, conditionAmount: typeof criteria.amount === "string" ? criteria.amount : null, conditionCurrency: typeof criteria.currencyCode === "string" ? criteria.currencyCode : null });
      }
    }
    return resolveShopifyFreeShipping({ candidates, profileCount: profiles.length, cartCurrency });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Shopify Admin API unavailable";
    const reason = /scope|access denied|forbidden/i.test(message) ? "Required Shopify read_shipping scope unavailable" : "Shopify delivery-profile audit unavailable";
    return resolveShopifyFreeShipping({ candidates: [], profileCount: 0, cartCurrency: input.cartCurrency || "", failureReason: reason });
  }
}
