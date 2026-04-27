import { GST_DEFAULT_SUPPLY_TYPE } from "./constants";
import { isKnownGstStateCode, resolveGstStateCode } from "./state-codes";
import type { GstServiceResult, GstSupplyType } from "./types";

export interface GstClassificationInput {
  sellerStateCode?: string | null;
  buyerGstin?: string | null;
  buyerStateCode?: string | null;
  shippingStateCode?: string | null;
  billingStateCode?: string | null;
  shopifyShippingProvince?: string | null;
  shopifyBillingProvince?: string | null;
  placeOfSupplyStateCode?: string | null;
  explicitSupplyType?: GstSupplyType;
}

export interface GstClassificationResult {
  supplyType: GstSupplyType;
  placeOfSupplyStateCode: string;
  isInterstate: boolean;
  customerType: "B2B" | "B2C";
  warnings: string[];
}

export function normalizeStateCode(value: string | null | undefined): string | null {
  return resolveGstStateCode(value);
}

export function determineSupplyType(input: GstClassificationInput): GstSupplyType {
  if (input.explicitSupplyType) {
    return input.explicitSupplyType;
  }

  return input.buyerGstin ? "B2B" : GST_DEFAULT_SUPPLY_TYPE;
}

export function determinePlaceOfSupply(input: GstClassificationInput): string | null {
  const shippingCode = String(input.shippingStateCode ?? "").trim();
  if (isKnownGstStateCode(shippingCode)) {
    return shippingCode;
  }

  const billingCode = String(input.billingStateCode ?? "").trim();
  if (isKnownGstStateCode(billingCode)) {
    return billingCode;
  }

  const normalizedShippingProvince =
    normalizeStateCode(input.shopifyShippingProvince) || normalizeStateCode(input.shippingStateCode);
  if (normalizedShippingProvince) {
    return normalizedShippingProvince;
  }

  const normalizedBillingProvince =
    normalizeStateCode(input.shopifyBillingProvince) || normalizeStateCode(input.billingStateCode);
  if (normalizedBillingProvince) {
    return normalizedBillingProvince;
  }

  return (
    normalizeStateCode(input.buyerStateCode) ||
    normalizeStateCode(input.placeOfSupplyStateCode)
  );
}

export function classifySupply(
  input: GstClassificationInput,
): GstServiceResult<GstClassificationResult> {
  const sellerStateCode = normalizeStateCode(input.sellerStateCode);
  const supplyType = determineSupplyType(input);
  const warnings: string[] = [];

  if (!sellerStateCode) {
    return { ok: false, error: "sellerStateCode is required for GST classification" };
  }

  const determinedPlaceOfSupply = determinePlaceOfSupply(input);
  const placeOfSupplyStateCode = determinedPlaceOfSupply || sellerStateCode;

  if (!determinedPlaceOfSupply) {
    warnings.push("Place of supply missing; defaulted to supplier state");
  }

  const isInterstate = sellerStateCode !== placeOfSupplyStateCode;

  return {
    ok: true,
    data: {
      supplyType,
      placeOfSupplyStateCode,
      isInterstate,
      customerType: input.buyerGstin ? "B2B" : GST_DEFAULT_SUPPLY_TYPE,
      warnings,
    },
  };
}
