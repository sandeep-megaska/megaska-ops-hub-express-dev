import test from "node:test";
import assert from "node:assert/strict";
import { submitCustomerPayoutDetails } from "./customer-refunds";
import { prisma } from "../db/prisma";

const auth = { shop: { id: "shop-1" }, session: { customer: { id: "cust-1" } } } as never;

const origFindFirst = prisma.refundRequest.findFirst;
const origTx = prisma.$transaction;

test.afterEach(() => {
  prisma.refundRequest.findFirst = origFindFirst;
  prisma.$transaction = origTx;
});

test("customer cannot access another customer refund", async () => {
  prisma.refundRequest.findFirst = async () => null as never;
  const result = await submitCustomerPayoutDetails(auth, "refund-x", { rail: "UPI", upiId: "u@ybl" });
  assert.equal((result as any).status, 404);
});

test("cannot submit payout details for prepaid refund", async () => {
  prisma.refundRequest.findFirst = async () => ({ id: "r1", method: "ORIGINAL", status: "DETAILS_PENDING", metadata: null } as never);
  const result = await submitCustomerPayoutDetails(auth, "r1", { rail: "UPI", upiId: "u@ybl" });
  assert.equal((result as any).status, 400);
});

test("successful submission changes status to DETAILS_SUBMITTED", async () => {
  let updated = false;
  prisma.refundRequest.findFirst = async ({ where }: any) => {
    if (!updated) return ({ id: "r1", method: "COD", status: "DETAILS_PENDING", metadata: null } as never);
    return ({ id: "r1", method: "COD", status: "DETAILS_SUBMITTED", amount: 100, currency: "INR", reason: null, createdAt: new Date(), updatedAt: new Date(), payoutDetails: { rail: "UPI", accountHolderName: null, bankAccountMasked: null, bankIfsc: null, upiIdMasked: "al***@ybl", phoneMasked: null, createdAt: new Date(), updatedAt: new Date() } } as never);
  };

  (prisma.$transaction as any) = async (fn: any) => {
    const tx = {
      refundPayoutDetails: { upsert: async () => ({}) },
      refundRequest: { update: async () => { updated = true; return {}; } },
      refundEvent: { create: async () => ({}) },
    };
    return fn(tx);
  };

  const result = await submitCustomerPayoutDetails(auth, "r1", { rail: "UPI", upiId: "alice@ybl" });
  assert.equal((result as any).status, 200);
  assert.equal((result as any).data.status, "DETAILS_SUBMITTED");
});
