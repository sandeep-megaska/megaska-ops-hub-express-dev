import { Prisma } from "../../generated/prisma/index.js";
import { prisma } from "../db/prisma.ts";
import type { DashboardWalletDto } from "./contract.ts";
import type { CustomerDashboardContext } from "./context.ts";
import { CustomerDashboardError } from "./errors.ts";

export type DashboardWalletSnapshot = { enabled: boolean; currency: string; balancePaise: number; reservedPaise: number; availablePaise: number; pendingRefundPaise: number; transactions: DashboardWalletTransactionSnapshot[] };
export type DashboardWalletTransactionSnapshot = { id: string; direction: "CREDIT" | "DEBIT"; amountPaise: number; currency: string; reason: string; orderNumber: string | null; createdAt: Date | string };
type WalletDeps = { getOrCreateWalletAccount: (customerProfileId: string, currency?: string, options?: { shopId?: string | null }) => Promise<unknown>; listWalletTransactions: (customerProfileId: string, currency?: string, limit?: number, options?: { shopId?: string | null }) => Promise<unknown[]>; queryRaw: (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => Promise<Array<{ total: unknown }>> };
const defaultDeps: WalletDeps = { getOrCreateWalletAccount: async (...args) => { const mod = await import("../wallet.ts"); return mod.getOrCreateWalletAccount(...args); }, listWalletTransactions: async (...args) => { const mod = await import("../wallet.ts"); return mod.listWalletTransactions(...args); }, queryRaw: (query, ...values) => prisma.$queryRaw(query as TemplateStringsArray, ...values) };
let deps = defaultDeps;
export function setDashboardWalletDependenciesForTest(overrides: Partial<WalletDeps>) { deps = { ...defaultDeps, ...overrides } as WalletDeps; }
export function resetDashboardWalletDependenciesForTest() { deps = defaultDeps; }

const clean = (v: unknown) => { const s = String(v ?? "").trim(); return s || null; };
const int = (v: unknown) => { const n = Number(v); return Number.isSafeInteger(n) ? n : 0; };
function nonNegative(v: unknown) { return Math.max(int(v), 0); }

async function loadActiveWalletReservedPaise(input: { shopId: string; customerProfileId: string; now: Date }): Promise<number> {
  const rows = await deps.queryRaw(Prisma.sql`
    SELECT COALESCE(SUM("reservedAmount"), 0)::int AS total
    FROM "WalletReservation"
    WHERE "shopId" = ${input.shopId}
      AND "customerProfileId" = ${input.customerProfileId}
      AND "status" = 'ACTIVE'::"WalletReservationStatus"
      AND "expiresAt" > ${input.now}
  `);
  return nonNegative(rows[0]?.total);
}

export function normalizeDashboardWalletTransaction(transaction: unknown, fallbackCurrency: string): DashboardWalletTransactionSnapshot {
  const row = transaction as Record<string, unknown>;
  const direction = String(row.direction || "").trim().toUpperCase() === "DEBIT" ? "DEBIT" : "CREDIT";
  return { id: String(row.id || ""), direction, amountPaise: nonNegative(row.amount ?? row.amountPaise), currency: clean(row.currency) || fallbackCurrency, reason: clean(row.reason) || clean(row.adminNote) || clean(row.transactionType) || clean(row.sourceType) || "Wallet transaction", orderNumber: clean(row.orderNumber), createdAt: (row.createdAt as Date | string | undefined) || new Date(0) };
}

export async function loadDashboardWalletSnapshot(input: { context: CustomerDashboardContext; enabled: boolean; currency?: string; transactionLimit?: number }): Promise<DashboardWalletSnapshot | null> {
  if (!input.enabled) return null;
  const currency = clean(input.currency) || "INR";
  const transactionLimit = input.transactionLimit ?? 15;
  try {
    const account = await deps.getOrCreateWalletAccount(input.context.customerProfileId, currency, { shopId: input.context.shopId });
    const transactions = await deps.listWalletTransactions(input.context.customerProfileId, currency, transactionLimit, { shopId: input.context.shopId });
    const reservedPaise = await loadActiveWalletReservedPaise({ shopId: input.context.shopId, customerProfileId: input.context.customerProfileId, now: new Date() });
    const balancePaise = int((account as { currentBalance?: unknown }).currentBalance);
    return { enabled: true, currency, balancePaise, reservedPaise, availablePaise: Math.max(balancePaise - reservedPaise, 0), pendingRefundPaise: 0, transactions: transactions.map((tx) => normalizeDashboardWalletTransaction(tx, currency)) };
  } catch (cause) {
    throw new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard wallet right now. Please try again.", status: 503, retryable: true, cause });
  }
}

export function buildDashboardWalletDto(snapshot: DashboardWalletSnapshot): DashboardWalletDto { return { enabled: snapshot.enabled, currency: snapshot.currency, balancePaise: int(snapshot.balancePaise), reservedPaise: int(snapshot.reservedPaise), availablePaise: int(snapshot.availablePaise), pendingRefundPaise: int(snapshot.pendingRefundPaise), transactions: snapshot.transactions.map((tx) => ({ id: tx.id, direction: tx.direction, amountPaise: int(tx.amountPaise), currency: tx.currency, reason: tx.reason, orderNumber: tx.orderNumber, createdAt: new Date(tx.createdAt).toISOString() })) }; }
