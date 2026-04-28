export type ReportWarningCode =
  | "SYNC_WARNING"
  | "INVOICE_GENERATION_FAILED"
  | "INVOICE_GENERATION_WARNING"
  | "INVOICE_GENERATION_SKIPPED"
  | "MISSING_CUSTOMER_NAME"
  | "MISSING_LINE_HSN"
  | "MISSING_LINE_TAX_RATE"
  | "NO_LINES_FALLBACK_TO_DOCUMENT"
  | "LINE_ITEMS_MISSING_IN_SNAPSHOT"
  | "NO_INVOICES_IN_RANGE"
  | "DIAGNOSTIC_COUNTS";

export type ReportWarning = {
  code: ReportWarningCode;
  message: string;
  documentId: string;
  documentNumber: string;
  lineNumber?: number;
};

export type B2cSalesRegisterRow = {
  invoiceDate: string;
  invoiceNumber: string;
  orderNumber: string;
  customer: string;
  placeOfSupply: string;
  product: string;
  variant: string;
  hsn: string;
  quantity: number;
  price: number;
  gstPercent: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
  total: number;
  itemType: string;
  paymentStatus: string;
  paymentGateway: string;
  fulfillmentStatus: string;
};

export type B2cSalesRegisterExport = {
  reportType: "B2C_SALES_REGISTER";
  headers: readonly string[];
  rows: B2cSalesRegisterRow[];
  warnings: ReportWarning[];
  rowCount: number;
  csv: string;
};
