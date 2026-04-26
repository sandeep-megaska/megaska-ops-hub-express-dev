import type { GstDocumentLineInput, GstInvoiceDraftInput, GstServiceResult } from "./types";
import { isKnownGstStateCode, resolveGstStateCode } from "./state-codes";

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[A-Z0-9]{3}$/;
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const PREFIX_REGEX = /^[A-Z0-9/_-]{1,12}$/;

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function isValidStateCode(value: string | null | undefined): boolean {
  return isKnownGstStateCode(normalize(value));
}

export function validateLineItems(lines: GstDocumentLineInput[]): GstServiceResult<true> {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, error: "At least one GST line is required" };
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const row = index + 1;

    if (!normalize(line.description)) {
      return { ok: false, error: `Line ${row}: description is required` };
    }
    if (Number(line.quantity) <= 0) {
      return { ok: false, error: `Line ${row}: quantity must be > 0` };
    }
    if (Number(line.unitPrice) < 0) {
      return { ok: false, error: `Line ${row}: unitPrice cannot be negative` };
    }
    if (Number(line.taxRate) < 0 || Number(line.taxRate) > 100) {
      return { ok: false, error: `Line ${row}: taxRate must be between 0 and 100` };
    }

    const gross = Number(line.quantity) * Number(line.unitPrice);
    const discount = Number(line.discount || 0);
    if (discount < 0) {
      return { ok: false, error: `Line ${row}: discount cannot be negative` };
    }
    if (discount > gross) {
      return { ok: false, error: `Line ${row}: discount cannot exceed gross amount` };
    }
  }

  return { ok: true, data: true };
}

export interface ValidatedDraftPayload {
  normalizedCurrency: string;
  normalizedBillingStateCode: string | null;
  normalizedShippingStateCode: string | null;
  normalizedPlaceOfSupplyStateCode: string | null;
  normalizedBuyerGstin: string | null;
  normalizedBuyerStateCode: string | null;
}

export function validateDocumentDraftPayload(
  payload: GstInvoiceDraftInput,
): GstServiceResult<ValidatedDraftPayload> {
  const lineValidation = validateLineItems(payload.lines);
  if (!lineValidation.ok) {
    return { ok: false, error: lineValidation.error || "Invalid GST line items" };
  }

  const billingStateCode = resolveGstStateCode(payload.billingStateCode);
  const shippingStateCode = resolveGstStateCode(payload.shippingStateCode);
  const placeOfSupplyStateCode = resolveGstStateCode(payload.placeOfSupplyStateCode);

  if (normalize(payload.placeOfSupplyStateCode) && !placeOfSupplyStateCode) {
    return { ok: false, error: "placeOfSupplyStateCode must be a valid GST state code" };
  }

  if (normalize(payload.billingStateCode) && !billingStateCode) {
    return { ok: false, error: "billingStateCode must be a valid GST state code" };
  }

  if (normalize(payload.shippingStateCode) && !shippingStateCode) {
    return { ok: false, error: "shippingStateCode must be a valid GST state code" };
  }

  const buyerGstin = normalize(payload.buyer?.gstin).toUpperCase();
  if (buyerGstin && !GSTIN_REGEX.test(buyerGstin)) {
    return { ok: false, error: "buyer.gstin must be a valid GSTIN" };
  }

  const buyerStateCode = resolveGstStateCode(payload.buyer?.stateCode);
  if (normalize(payload.buyer?.stateCode) && !buyerStateCode) {
    return { ok: false, error: "buyer.stateCode must be a valid GST state code" };
  }

  const currency = normalize(payload.currency || "INR").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, error: "currency must be a 3-letter ISO code" };
  }

  return {
    ok: true,
    data: {
      normalizedCurrency: currency,
      normalizedBillingStateCode: billingStateCode || null,
      normalizedShippingStateCode: shippingStateCode || null,
      normalizedPlaceOfSupplyStateCode: placeOfSupplyStateCode || null,
      normalizedBuyerGstin: buyerGstin || null,
      normalizedBuyerStateCode: buyerStateCode || null,
    },
  };
}
