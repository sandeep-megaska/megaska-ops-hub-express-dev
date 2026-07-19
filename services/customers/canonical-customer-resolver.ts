import type { CustomerProfile, Prisma } from "../../generated/prisma/index.js";
import { InvalidCustomerIdentityError } from "./customer-identity-errors";
import {
  normalizeCountry,
  normalizeCustomerAttributes,
  normalizeEmail,
  normalizePhone,
  normalizeShopifyCustomerId,
  normalizeWhitespace,
} from "./customer-identity-normalization";
import { CustomerIdentityRepository, type IdentityTransaction } from "./customer-identity-repository";
import type {
  CanonicalCustomerResolution,
  CustomerIdentityAttributes,
  CustomerIdentityLogger,
  CustomerIdentityMatch,
  ResolveCanonicalCustomerInput,
} from "./customer-identity-types";

const defaultLogger: CustomerIdentityLogger = (event) => console.info(event.event, event);

function cleanAttributes(attributes?: CustomerIdentityAttributes): CustomerIdentityAttributes {
  const cleaned = normalizeCustomerAttributes(attributes) ?? {};
  if (cleaned.countryRegion) cleaned.countryRegion = normalizeCountry(cleaned.countryRegion);
  return Object.fromEntries(Object.entries(cleaned).filter(([, value]) => value !== null && value !== undefined)) as CustomerIdentityAttributes;
}

function missingAttributeUpdates(profile: CustomerProfile, attributes: CustomerIdentityAttributes) {
  return Object.fromEntries(Object.entries(attributes).filter(([key, value]) => !profile[key as keyof CustomerProfile] && value)) as CustomerIdentityAttributes;
}

export class CanonicalCustomerResolver {
  private readonly repository: CustomerIdentityRepository;
  private readonly logger: CustomerIdentityLogger;

  constructor(repository = new CustomerIdentityRepository(), logger: CustomerIdentityLogger = defaultLogger) {
    this.repository = repository;
    this.logger = logger;
  }

  async resolveCanonicalCustomerProfile(input: ResolveCanonicalCustomerInput): Promise<CanonicalCustomerResolution> {
    const shopId = normalizeWhitespace(input.shopId);
    const source = normalizeWhitespace(input.source);
    if (!shopId) throw new InvalidCustomerIdentityError("shopId is required");
    if (!source) throw new InvalidCustomerIdentityError("source is required");

    const shopifyCustomerId = normalizeShopifyCustomerId(input.shopifyCustomerId);
    const email = normalizeEmail(input.email);
    const country = normalizeCountry(input.country) ?? "IN";
    const phoneE164 = normalizePhone(input.phone, country);
    const attributes = cleanAttributes(input.customerAttributes);
    const identifiersPresent = {
      shopifyCustomerId: Boolean(shopifyCustomerId),
      verifiedPhone: Boolean(phoneE164 && input.phoneVerified),
      verifiedEmail: Boolean(email && input.emailVerified),
    };
    if (!shopifyCustomerId && !(phoneE164 && input.phoneVerified) && !(email && input.emailVerified)) {
      throw new InvalidCustomerIdentityError("At least one canonical or verified customer identifier is required");
    }

    const resolution = await this.repository.runInIdentityTransaction(shopId, async (tx) => {
      const candidates = await this.repository.findIdentityCandidates(tx, {
        shopId,
        shopifyCustomerId,
        phoneE164,
        usePhone: Boolean(input.phoneVerified),
        email,
        useEmail: Boolean(input.emailVerified),
      });
      const matchedBy = [...new Set(candidates.flatMap((candidate) => candidate.matchedBy))];

      if (candidates.length > 1) {
        const ids = candidates.map((candidate) => candidate.customerProfile.id);
        await this.repository.recordIdentityConflict(tx, { shopId, source, customerProfileIds: ids, identifiersPresent });
        return this.conflict(matchedBy, ids);
      }
      if (candidates.length === 0) {
        const customerProfile = await this.repository.createCustomerProfile(tx, {
          shopId,
          shopifyCustomerId,
          phoneE164,
          phoneVerifiedAt: phoneE164 && input.phoneVerified ? new Date() : null,
          email,
          ...attributes,
        });
        return { outcome: "CREATED", matchedBy: [], customerProfile, conflicts: [] } as CanonicalCustomerResolution;
      }

      return this.resolveExisting(tx, shopId, candidates[0].customerProfile, candidates[0].matchedBy, {
        shopifyCustomerId, phoneE164, phoneVerified: Boolean(input.phoneVerified), email,
        emailVerified: Boolean(input.emailVerified), attributes, source, identifiersPresent,
      });
    });

    this.logger({
      event: "customer_identity_resolution",
      resolver: "CanonicalCustomerResolver",
      source,
      matchedBy: resolution.matchedBy,
      outcome: resolution.outcome,
      customerProfileId: resolution.customerProfile?.id ?? null,
      shopId,
    });
    return resolution;
  }

  private async resolveExisting(
    tx: IdentityTransaction,
    shopId: string,
    profile: CustomerProfile,
    matchedBy: CustomerIdentityMatch[],
    input: { shopifyCustomerId: string | null; phoneE164: string | null; phoneVerified: boolean; email: string | null; emailVerified: boolean; attributes: CustomerIdentityAttributes; source: string; identifiersPresent: { shopifyCustomerId: boolean; verifiedPhone: boolean; verifiedEmail: boolean } },
  ): Promise<CanonicalCustomerResolution> {
    const incompatible = Boolean(
      (input.shopifyCustomerId && profile.shopifyCustomerId && input.shopifyCustomerId !== profile.shopifyCustomerId) ||
      (input.phoneVerified && input.phoneE164 && profile.phoneE164 && input.phoneE164 !== profile.phoneE164) ||
      (input.emailVerified && input.email && profile.email && input.email !== profile.email)
    );
    if (incompatible) {
      await this.repository.recordIdentityConflict(tx, { shopId, source: input.source, customerProfileIds: [profile.id], identifiersPresent: input.identifiersPresent });
      return this.conflict(matchedBy, [profile.id], "IDENTIFIER_ALREADY_LINKED");
    }

    const data: Prisma.CustomerProfileUncheckedUpdateInput = missingAttributeUpdates(profile, input.attributes);
    let linked = false;
    if (input.shopifyCustomerId && !profile.shopifyCustomerId) { data.shopifyCustomerId = input.shopifyCustomerId; linked = true; }
    if (input.phoneE164 && !profile.phoneE164) data.phoneE164 = input.phoneE164;
    if (input.phoneVerified && input.phoneE164 && !profile.phoneVerifiedAt) data.phoneVerifiedAt = new Date();
    if (input.emailVerified && input.email && !profile.email) data.email = input.email;

    if (Object.keys(data).length === 0) return { outcome: "MATCHED", matchedBy, customerProfile: profile, conflicts: [] };
    const customerProfile = await this.repository.updateCustomerProfile(tx, shopId, profile.id, data);
    return { outcome: linked ? "LINKED" : "ENRICHED", matchedBy, customerProfile, conflicts: [] };
  }

  private conflict(matchedBy: CustomerIdentityMatch[], ids: string[], code: "MULTIPLE_PROFILES" | "IDENTIFIER_ALREADY_LINKED" = "MULTIPLE_PROFILES"): CanonicalCustomerResolution {
    return {
      outcome: "IDENTITY_CONFLICT",
      matchedBy,
      customerProfile: null,
      conflicts: [{ code, identifiers: matchedBy, customerProfileIds: [...new Set(ids)].sort() }],
    };
  }

  resolveFromOTP(input: Omit<ResolveCanonicalCustomerInput, "source" | "phoneVerified">) {
    return this.resolveCanonicalCustomerProfile({ ...input, source: "OTP", phoneVerified: true });
  }
  resolveFromShopifyOrder(input: Omit<ResolveCanonicalCustomerInput, "source">) {
    return this.resolveCanonicalCustomerProfile({ ...input, source: "SHOPIFY_ORDER" });
  }
  resolveFromCheckout(input: Omit<ResolveCanonicalCustomerInput, "source">) {
    return this.resolveCanonicalCustomerProfile({ ...input, source: "CHECKOUT" });
  }
  resolveFromCustomerSync(input: Omit<ResolveCanonicalCustomerInput, "source">) {
    return this.resolveCanonicalCustomerProfile({ ...input, source: "CUSTOMER_SYNC" });
  }
}
