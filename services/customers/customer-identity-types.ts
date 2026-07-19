import type { CustomerProfile } from "../../generated/prisma/index.js";

export const CUSTOMER_IDENTITY_OUTCOMES = [
  "MATCHED",
  "CREATED",
  "ENRICHED",
  "LINKED",
  "IDENTITY_CONFLICT",
] as const;

export type CustomerIdentityOutcome = (typeof CUSTOMER_IDENTITY_OUTCOMES)[number];
export type CustomerIdentitySource = "OTP" | "SHOPIFY_ORDER" | "CHECKOUT" | "CUSTOMER_SYNC" | (string & {});
export type CustomerIdentityMatch = "SHOPIFY_CUSTOMER_ID" | "VERIFIED_PHONE" | "VERIFIED_EMAIL";

export type CustomerIdentityAttributes = Partial<Pick<CustomerProfile,
  "fullName" | "firstName" | "lastName" | "addressLine1" | "addressLine2" | "city" |
  "stateProvince" | "postalCode" | "countryRegion"
>>;

export interface ResolveCanonicalCustomerInput {
  shopId: string;
  source: CustomerIdentitySource;
  shopifyCustomerId?: unknown;
  phone?: string | null;
  phoneVerified?: boolean;
  email?: string | null;
  emailVerified?: boolean;
  country?: string | null;
  customerAttributes?: CustomerIdentityAttributes;
}

export interface CustomerIdentityConflict {
  code: "MULTIPLE_PROFILES" | "IDENTIFIER_ALREADY_LINKED";
  identifiers: CustomerIdentityMatch[];
  customerProfileIds: string[];
}

export interface CanonicalCustomerResolution {
  outcome: CustomerIdentityOutcome;
  matchedBy: CustomerIdentityMatch[];
  customerProfile: CustomerProfile | null;
  conflicts: CustomerIdentityConflict[];
}

export interface CustomerIdentityResolutionEvent {
  event: "customer_identity_resolution";
  resolver: "CanonicalCustomerResolver";
  source: string;
  matchedBy: CustomerIdentityMatch[];
  outcome: CustomerIdentityOutcome;
  customerProfileId: string | null;
  shopId: string;
}

export type CustomerIdentityLogger = (event: CustomerIdentityResolutionEvent) => void;
