import { prisma } from "../db/prisma";
import type { GstDocumentStatus, GstDocumentType, GstNumberingStrategy } from "./constants";

export interface GstSettingsRecord {
  id: string;
  legalName: string;
  tradeName: string | null;
  gstin: string;
  pan: string | null;
  stateCode: string;
  invoicePrefix: string;
  creditNotePrefix: string;
  debitNotePrefix: string;
  invoiceNumberStrategy: GstNumberingStrategy;
  defaultCurrency: string;
  priceIncludesTax: boolean;
  einvoiceEnabled: boolean;
  isActive: boolean;
  updatedAt?: Date;
}

export interface GstCounterRecord {
  id?: string;
  lastNumber: number;
}

export interface GstDocumentRecord {
  id: string;
  documentType: GstDocumentType;
  status: GstDocumentStatus;
  documentNumber: string;
  documentDate: Date;
  gstSettingsId: string;
  originalDocumentId?: string | null;
  supplyType?: string;
  placeOfSupplyStateCode?: string;
  isInterstate?: boolean;
  taxableAmount: unknown;
  cgstAmount: unknown;
  sgstAmount: unknown;
  igstAmount: unknown;
  cessAmount: unknown;
  totalAmount: unknown;
  lines?: Array<Record<string, unknown>>;
  gstSettings?: GstSettingsRecord;
  originalDocument?: GstDocumentRecord | null;
  [key: string]: unknown;
}

export interface GstAuditLogCreateInput {
  gstSettingsId?: string | null;
  gstDocumentId?: string | null;
  gstPartyId?: string | null;
  gstExportId?: string | null;
  reconciliationRunId?: string | null;
  action: string;
  actorType: string;
  actorId?: string | null;
  previousState?: unknown;
  nextState?: unknown;
  metadata?: unknown;
}

/**
 * GST-only Prisma facade.
 *
 * This keeps GST module compilation stable even when generated client is stale,
 * while preserving typed contracts in GST services.
 */
export interface GstPrismaClient {
  gstSettings: {
    findUnique: (args: unknown) => Promise<GstSettingsRecord | null>;
    findFirst: (args: unknown) => Promise<GstSettingsRecord | null>;
    findMany: (args: unknown) => Promise<Array<Pick<GstSettingsRecord, "id" | "gstin">>>;
    upsert: (args: unknown) => Promise<GstSettingsRecord>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  gstCounter: {
    upsert: (args: unknown) => Promise<GstCounterRecord>;
    update: (args: unknown) => Promise<GstCounterRecord>;
  };
  gstDocument: {
    create: (args: unknown) => Promise<GstDocumentRecord>;
    update: (args: unknown) => Promise<GstDocumentRecord>;
    findUnique: (args: unknown) => Promise<GstDocumentRecord | null>;
    findFirst: (args: unknown) => Promise<GstDocumentRecord | null>;
    findMany: (args: unknown) => Promise<GstDocumentRecord[]>;
    count: (args: unknown) => Promise<number>;
    groupBy: (args: unknown) => Promise<Array<{ status: GstDocumentStatus; _count?: { _all?: number } }>>;
  };
  gstDocumentLine: {
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
  gstExport: {
    create: (args: unknown) => Promise<{ id: string; exportType: string; status: string; periodStart?: Date; periodEnd?: Date }>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstExportItem: {
    createMany: (args: unknown) => Promise<{ count: number }>;
  };
  gstReconciliationRun: {
    create: (args: unknown) => Promise<Record<string, unknown>>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstReportRun: {
    create: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  };
  gstAuditLog: {
    create: (args: unknown) => Promise<Record<string, unknown>>;
  };
  gstParty: {
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
  };
  $transaction: <T>(fn: (tx: GstPrismaClient) => Promise<T>) => Promise<T>;
}

export const gstDb = prisma as unknown as GstPrismaClient;
