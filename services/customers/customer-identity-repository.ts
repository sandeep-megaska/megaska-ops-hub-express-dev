import type { CustomerProfile, Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma";
import type { CustomerIdentityMatch } from "./customer-identity-types";

type IdentityTransaction = Prisma.TransactionClient;
type IdentityDb = typeof prisma;
type Candidate = { customerProfile: CustomerProfile; matchedBy: CustomerIdentityMatch[] };

const RETRYABLE_CODES = new Set(["P2002", "P2034"]);

export class CustomerIdentityRepository {
  constructor(private readonly db: IdentityDb = prisma, private readonly maxTransactionAttempts = 3) {}

  findByCanonicalShopifyCustomer(tx: IdentityTransaction, shopId: string, shopifyCustomerId: string) {
    return tx.customerProfile.findMany({ where: { shopId, shopifyCustomerId } });
  }

  findByCanonicalPhone(tx: IdentityTransaction, shopId: string, phoneE164: string) {
    return tx.customerProfile.findMany({ where: { shopId, phoneE164, phoneVerifiedAt: { not: null } } });
  }

  findByVerifiedEmail(tx: IdentityTransaction, shopId: string, email: string) {
    // Email verification is supplied by the trusted resolver caller until the schema gains verification metadata.
    return tx.customerProfile.findMany({ where: { shopId, email } });
  }

  createCustomerProfile(tx: IdentityTransaction, data: Prisma.CustomerProfileUncheckedCreateInput) {
    return tx.customerProfile.create({ data });
  }

  updateCustomerProfile(tx: IdentityTransaction, shopId: string, id: string, data: Prisma.CustomerProfileUncheckedUpdateInput) {
    return tx.customerProfile.update({ where: { id, shopId }, data });
  }

  linkShopifyCustomer(tx: IdentityTransaction, shopId: string, id: string, shopifyCustomerId: string) {
    return this.updateCustomerProfile(tx, shopId, id, { shopifyCustomerId });
  }

  markPhoneVerified(tx: IdentityTransaction, shopId: string, id: string, phoneE164: string, verifiedAt = new Date()) {
    return this.updateCustomerProfile(tx, shopId, id, { phoneE164, phoneVerifiedAt: verifiedAt });
  }

  async findIdentityCandidates(tx: IdentityTransaction, input: {
    shopId: string; shopifyCustomerId: string | null; phoneE164: string | null; usePhone: boolean; email: string | null; useEmail: boolean;
  }): Promise<Candidate[]> {
    const lookups: Array<Promise<CustomerProfile[]>> = [];
    const matches: CustomerIdentityMatch[] = [];
    if (input.shopifyCustomerId) { lookups.push(this.findByCanonicalShopifyCustomer(tx, input.shopId, input.shopifyCustomerId)); matches.push("SHOPIFY_CUSTOMER_ID"); }
    if (input.phoneE164 && input.usePhone) { lookups.push(this.findByCanonicalPhone(tx, input.shopId, input.phoneE164)); matches.push("VERIFIED_PHONE"); }
    if (input.email && input.useEmail) { lookups.push(this.findByVerifiedEmail(tx, input.shopId, input.email)); matches.push("VERIFIED_EMAIL"); }
    const results = await Promise.all(lookups);
    const candidates = new Map<string, Candidate>();
    results.forEach((profiles, index) => profiles.forEach((profile) => {
      const current = candidates.get(profile.id) ?? { customerProfile: profile, matchedBy: [] };
      current.matchedBy.push(matches[index]);
      candidates.set(profile.id, current);
    }));
    return [...candidates.values()];
  }

  async runInIdentityTransaction<T>(shopId: string, operation: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxTransactionAttempts; attempt += 1) {
      try {
        return await this.db.$transaction(async (tx) => {
          // A tenant-wide transaction lock makes overlapping multi-identifier sets serialize safely.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-identity:${shopId}`}))`;
          return operation(tx);
        }, { isolationLevel: "Serializable" });
      } catch (error) {
        lastError = error;
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
        if (!RETRYABLE_CODES.has(code) || attempt === this.maxTransactionAttempts) throw error;
      }
    }
    throw lastError;
  }
}

export type { Candidate as CustomerIdentityCandidate, IdentityTransaction };
