import type {
  GstDocumentStatus,
  GstDocumentType,
  GstNoteDocumentType,
  GstNumberingStrategy,
  GstSupplyType,
} from "./constants";

export type { GstDocumentType, GstDocumentStatus, GstNumberingStrategy, GstSupplyType };

export interface GstTaxBreakdown {
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalAmount: number;
}

export interface GstDocumentLineInput {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  cessRate?: number;
  hsnOrSac?: string;
  unit?: string;
  discount?: number;
}

export interface GstDocumentInput {
  documentType: GstDocumentType;
  supplyType: GstSupplyType;
  placeOfSupplyStateCode: string;
  isInterstate: boolean;
  currency?: string;
  lines: GstDocumentLineInput[];
}

export interface GstServiceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  errorCode?: string;
  errorDetails?: Record<string, unknown>;
}

export type GstExportType = "invoice_register" | "notes_register";

export interface GstExportRequest {
  gstSettingsId: string;
  exportType: GstExportType;
  periodStart: Date;
  periodEnd: Date;
  filters?: Record<string, unknown>;
}

export interface GstPartyInput {
  legalName?: string;
  gstin?: string | null;
  stateCode?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface GstInvoiceDraftInput {
  gstSettingsId?: string;
  sourceOrderId?: string;
  sourceOrderNumber?: string;
  sourceReference?: string;
  shopifyOrderId?: string;
  shopifyOrderName?: string;
  documentDate?: Date | string;
  billingStateCode?: string | null;
  shippingStateCode?: string | null;
  buyer?: GstPartyInput;
  supplyType?: GstSupplyType;
  placeOfSupplyStateCode?: string;
  isInterstate?: boolean;
  reverseCharge?: boolean;
  currency?: string;
  lines: GstDocumentLineInput[];
  metadata?: Record<string, unknown>;
}

export interface GstNoteDraftInput extends GstInvoiceDraftInput {
  noteType: GstNoteDocumentType;
  originalDocumentId?: string;
}

export interface GstReconcileRunInput {
  gstSettingsId: string;
  periodStart: Date;
  periodEnd: Date;
  sourceSystem: string;
  sourceDocuments: Array<{
    documentNumber: string;
    documentType?: string;
    documentDate?: string;
    totalAmount?: number;
    status?: string;
  }>;
}
