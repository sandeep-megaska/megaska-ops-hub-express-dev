import { clinicScope } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { allocateBillNumber } from "@/services/documents/numbering";

/**
 * Patient billing.
 *
 * There is deliberately no tax engine here. Healthcare services provided by a
 * clinical establishment are GST-exempt and the pilot clinic is unregistered,
 * so what goes to the patient is a payment receipt — no HSN, no tax breakup, no
 * place of supply. `Clinic.taxProfile` stays null until a tenant has non-exempt
 * revenue, and that is the only place tax logic should ever appear.
 *
 * Money is in minor units (paise) end to end. Floats never touch a bill.
 */

export type BillLineInput = {
  description: string;
  quantity?: number;
  unitPriceMinor: number;
  appointmentId?: string | null;
  packageId?: string | null;
};

export function formatMinor(minor: number, currency = "INR", locale = "en-IN") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(minor / 100);
}

export async function createBill(params: {
  clinicId: string;
  patientId: string;
  lines: BillLineInput[];
  discountMinor?: number;
  notes?: string | null;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);

  const lines = params.lines.map((line) => {
    const quantity = line.quantity ?? 1;
    return {
      description: line.description,
      quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: quantity * line.unitPriceMinor,
      appointmentId: line.appointmentId ?? null,
      packageId: line.packageId ?? null,
    };
  });

  const subtotalMinor = lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const discountMinor = params.discountMinor ?? 0;

  const bill = await db.bill.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      subtotalMinor,
      discountMinor,
      totalMinor: subtotalMinor - discountMinor,
      notes: params.notes ?? null,
      lines: { create: lines },
    },
    include: { lines: true },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "CREATE",
    resourceType: "Bill",
    resourceId: bill.id,
    patientId: params.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
  });

  return bill;
}

/** Assigns the receipt number and locks the amounts. */
export async function issueBill(params: {
  clinicId: string;
  billId: string;
  timezone?: string;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);
  const bill = await db.bill.findFirst({ where: { id: params.billId } });
  if (!bill) throw new Error("Bill not found.");
  if (bill.status !== "DRAFT") return bill;

  const billNo = await allocateBillNumber(params.clinicId, params.timezone ?? "Asia/Kolkata");

  const issued = await db.bill.update({
    where: { id: bill.id },
    data: { billNo, status: "ISSUED", issuedAt: new Date() },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "UPDATE",
    resourceType: "Bill",
    resourceId: bill.id,
    patientId: bill.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
    metadata: { billNo },
  });

  return issued;
}

/**
 * Records a payment and re-derives the bill's status from the total received,
 * rather than trusting a caller-supplied status. Part payments are normal in a
 * physio practice, so PART_PAID is a first-class state, not an error.
 */
export async function recordPayment(params: {
  clinicId: string;
  billId: string;
  amountMinor: number;
  mode: "CASH" | "UPI" | "CARD" | "BANK_TRANSFER" | "ONLINE" | "OTHER";
  reference?: string | null;
  receivedAt?: Date;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);

  return db.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: params.billId },
      include: { payments: true },
    });
    if (!bill) throw new Error("Bill not found.");

    await tx.payment.create({
      data: {
        clinicId: params.clinicId,
        patientId: bill.patientId,
        billId: bill.id,
        amountMinor: params.amountMinor,
        mode: params.mode,
        reference: params.reference ?? null,
        receivedAt: params.receivedAt ?? new Date(),
      },
    });

    const paidMinor =
      bill.payments.reduce((sum, p) => sum + p.amountMinor, 0) + params.amountMinor;

    const status =
      paidMinor >= bill.totalMinor ? "PAID" : paidMinor > 0 ? "PART_PAID" : bill.status;

    return tx.bill.update({
      where: { id: bill.id },
      data: { paidMinor, status },
      include: { lines: true, payments: true, patient: true },
    });
  });
}

/**
 * Consumes one credit from a patient's active session package.
 *
 * Physio is sold in packs ("10 sessions for Rs 6,000"), so a completed
 * appointment normally decrements a pack rather than generating a fresh bill.
 * Returns null when the patient has no active pack, so the caller falls back to
 * billing the visit.
 */
export async function consumePackageCredit(params: {
  clinicId: string;
  patientId: string;
  serviceId?: string | null;
}) {
  const db = clinicScope(params.clinicId);

  return db.$transaction(async (tx) => {
    const pack = await tx.sessionPackage.findFirst({
      where: {
        patientId: params.patientId,
        status: "ACTIVE",
        ...(params.serviceId ? { OR: [{ serviceId: params.serviceId }, { serviceId: null }] } : {}),
      },
      orderBy: { purchasedAt: "asc" },
    });
    if (!pack || pack.sessionsUsed >= pack.sessionsTotal) return null;
    if (pack.expiresAt && pack.expiresAt.getTime() < Date.now()) {
      await tx.sessionPackage.update({ where: { id: pack.id }, data: { status: "EXPIRED" } });
      return null;
    }

    const sessionsUsed = pack.sessionsUsed + 1;
    return tx.sessionPackage.update({
      where: { id: pack.id },
      data: {
        sessionsUsed,
        status: sessionsUsed >= pack.sessionsTotal ? "EXHAUSTED" : "ACTIVE",
      },
    });
  });
}

/** The year-end figure her CA asks for, which she currently rebuilds by hand. */
export async function revenueSummary(params: {
  clinicId: string;
  from: Date;
  to: Date;
}) {
  const db = clinicScope(params.clinicId);
  const payments = await db.payment.findMany({
    where: { receivedAt: { gte: params.from, lte: params.to } },
    select: { amountMinor: true, mode: true, receivedAt: true },
  });

  const byMode = new Map<string, number>();
  let totalMinor = 0;
  for (const payment of payments) {
    totalMinor += payment.amountMinor;
    byMode.set(payment.mode, (byMode.get(payment.mode) ?? 0) + payment.amountMinor);
  }

  return {
    totalMinor,
    count: payments.length,
    byMode: [...byMode.entries()].map(([mode, minor]) => ({ mode, minor })),
  };
}
