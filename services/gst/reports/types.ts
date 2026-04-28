export type ReportWarningCode =
  | "MISSING_CUSTOMER_NAME"
  | "MISSING_LINE_HSN"
  | "MISSING_LINE_TAX_RATE"
  | "NO_LINES_FALLBACK_TO_DOCUMENT";

export type ReportWarning = {
  code: ReportWarningCode;
  message: string;
  documentId: string;
  documentNumber: string;
  lineNumber?: number;
};

export type B2cSalesRegisterRow = {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin: string;
  placeOfSupply: string;
  invoiceValue: number;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  hsnCode: string;
};
