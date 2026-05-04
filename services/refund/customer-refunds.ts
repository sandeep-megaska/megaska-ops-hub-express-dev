import crypto from "crypto";
import { prisma } from "../db/prisma";
import { type AuthenticatedExchangeContext } from "../exchange/auth";
import type { RefundPayoutRail, RefundRequest, RefundStatus } from "@prisma/client";

const UPI_REGEX = /^[a-z0-9._-]{2,}@[a-z]{2,}$/i;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

type RefundWithPayout = RefundRequest & {
  payoutDetails: {
    rail: RefundPayoutRail;
    accountHolderName: string | null;
    bankAccountMasked: string | null;
    bankIfsc: string | null;
    upiIdMasked: string | null;
    phoneMasked: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

function resolveEncryptionKey() {
  const seed = process.env.REFUND_PAYOUT_ENCRYPTION_KEY || process.env.SESSION_SECRET || "dev-refund-key";
  return crypto.createHash("sha256").update(seed).digest();
}

function encryptValue(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", resolveEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function maskAccount(value: string) {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 4) return "*".repeat(compact.length);
  return `${"*".repeat(Math.max(0, compact.length - 4))}${compact.slice(-4)}`;
}

function maskUpi(value: string) {
  const [handle, domain] = value.split("@");
  if (!handle || !domain) return "***";
  const visible = handle.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(handle.length - 2, 1))}@${domain}`;
}

function validateSubmission(input: Record<string, unknown>) {
  const rail = String(input.rail || "").toUpperCase();
  if (rail !== "UPI" && rail !== "BANK") {
    return { error: "Invalid payout method" };
  }

  if (rail === "UPI") {
    const upiId = String(input.upiId || "").trim().toLowerCase();
    if (!upiId) return { error: "upiId is required" };
    if (!UPI_REGEX.test(upiId)) return { error: "Invalid UPI ID format" };
    return { rail, upiId } as const;
  }

  const accountHolderName = String(input.accountHolderName || "").trim();
  const accountNumber = String(input.accountNumber || "").trim();
  const confirmAccountNumber = String(input.confirmAccountNumber || "").trim();
  const ifsc = String(input.ifsc || "").trim().toUpperCase();

  if (!accountHolderName) return { error: "accountHolderName is required" };
  if (!accountNumber) return { error: "accountNumber is required" };
  if (!confirmAccountNumber) return { error: "confirmAccountNumber is required" };
  if (accountNumber !== confirmAccountNumber) return { error: "Account number confirmation does not match" };
  if (!ifsc) return { error: "ifsc is required" };
  if (!IFSC_REGEX.test(ifsc)) return { error: "Invalid IFSC format" };

  return { rail, accountHolderName, accountNumber, ifsc } as const;
}

function canSubmit(status: RefundStatus, metadata: unknown) {
  if (status === "DETAILS_PENDING") return true;
  if (status === "FAILED") {
    if (metadata && typeof metadata === "object" && "payoutDetailsUnlocked" in metadata) {
      return (metadata as Record<string, unknown>).payoutDetailsUnlocked === true;
    }
  }
  return false;
}

function toSummary(refund: RefundWithPayout) {
  return {
    id: refund.id,
    method: refund.method,
    status: refund.status,
    amount: refund.amount,
    currency: refund.currency,
    reason: refund.reason,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt,
    payoutDetails: refund.payoutDetails
      ? {
          rail: refund.payoutDetails.rail,
          accountHolderName: refund.payoutDetails.accountHolderName,
          bankAccountMasked: refund.payoutDetails.bankAccountMasked,
          bankIfscMasked: refund.payoutDetails.bankIfsc ? `${refund.payoutDetails.bankIfsc.slice(0, 2)}******${refund.payoutDetails.bankIfsc.slice(-2)}` : null,
          upiIdMasked: refund.payoutDetails.upiIdMasked,
          phoneMasked: refund.payoutDetails.phoneMasked,
          createdAt: refund.payoutDetails.createdAt,
          updatedAt: refund.payoutDetails.updatedAt,
        }
      : null,
  };
}

export async function listCustomerRefunds(auth: AuthenticatedExchangeContext) {
  const refunds = await prisma.refundRequest.findMany({
    where: { shopId: auth.shop.id, customerProfileId: auth.session.customer.id },
    include: { payoutDetails: true },
    orderBy: { createdAt: "desc" },
  });
  return refunds.map((r) => toSummary(r as RefundWithPayout));
}

export async function getCustomerRefundById(auth: AuthenticatedExchangeContext, id: string) {
  const refund = await prisma.refundRequest.findFirst({
    where: { id, shopId: auth.shop.id, customerProfileId: auth.session.customer.id },
    include: { payoutDetails: true },
  });
  if (!refund) return null;
  return toSummary(refund as RefundWithPayout);
}

export async function submitCustomerPayoutDetails(auth: AuthenticatedExchangeContext, id: string, payload: Record<string, unknown>) {
  const refund = await prisma.refundRequest.findFirst({
    where: { id, shopId: auth.shop.id, customerProfileId: auth.session.customer.id },
  });
  if (!refund) return { status: 404, error: "Refund not found" };
  if (refund.method !== "COD") return { status: 400, error: "Payout details are only supported for COD refunds" };
  if (!canSubmit(refund.status, refund.metadata)) return { status: 400, error: "Payout details cannot be submitted in current status" };

  const validated = validateSubmission(payload);
  if ("error" in validated) return { status: 400, error: validated.error };

  await prisma.$transaction(async (tx) => {
    if (validated.rail === "UPI") {
      await tx.refundPayoutDetails.upsert({
        where: { refundRequestId: id },
        create: {
          refundRequestId: id,
          rail: "UPI",
          upiIdMasked: maskUpi(validated.upiId),
          upiIdEnc: encryptValue(validated.upiId),
        },
        update: {
          rail: "UPI",
          accountHolderName: null,
          bankAccountMasked: null,
          bankAccountEnc: null,
          bankIfsc: null,
          upiIdMasked: maskUpi(validated.upiId),
          upiIdEnc: encryptValue(validated.upiId),
        },
      });
    } else {
      await tx.refundPayoutDetails.upsert({
        where: { refundRequestId: id },
        create: {
          refundRequestId: id,
          rail: "BANK",
          accountHolderName: validated.accountHolderName,
          bankAccountMasked: maskAccount(validated.accountNumber),
          bankAccountEnc: encryptValue(validated.accountNumber),
          bankIfsc: encryptValue(validated.ifsc),
        },
        update: {
          rail: "BANK",
          accountHolderName: validated.accountHolderName,
          bankAccountMasked: maskAccount(validated.accountNumber),
          bankAccountEnc: encryptValue(validated.accountNumber),
          bankIfsc: encryptValue(validated.ifsc),
          upiIdMasked: null,
          upiIdEnc: null,
        },
      });
    }

    await tx.refundRequest.update({
      where: { id },
      data: {
        status: "DETAILS_SUBMITTED",
        detailsSubmittedAt: new Date(),
      },
    });

    await tx.refundEvent.create({
      data: {
        refundRequestId: id,
        actorType: "CUSTOMER",
        actorId: auth.session.customer.id,
        eventType: "DETAILS_SUBMITTED",
        fromStatus: refund.status,
        toStatus: "DETAILS_SUBMITTED",
      },
    });
  });

  const updated = await prisma.refundRequest.findFirst({
    where: { id, shopId: auth.shop.id, customerProfileId: auth.session.customer.id },
    include: { payoutDetails: true },
  });

  return { status: 200, data: toSummary(updated as RefundWithPayout) };
}

export const __testables = { validateSubmission, canSubmit, maskAccount, maskUpi };
