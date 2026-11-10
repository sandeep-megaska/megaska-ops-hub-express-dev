// Different-style exchange: the team swaps an item for another product (not just
// another size). Prices come from Shopify: what the customer actually paid for the
// line (after discounts) and the replacement's current selling price.
// - Dearer: the customer pays the difference by payment link before it ships.
// - Cheaper: the team decides each time: store credit, no refund, or a refund
//   they make themselves (recorded).
// Once the difference is paid or settled, the style is locked.

export const STYLE_SETTLEMENTS = ["COLLECT", "STORE_CREDIT", "NO_REFUND", "MANUAL_REFUND"] as const;
export type StyleSettlement = (typeof STYLE_SETTLEMENTS)[number];
export const SETTLEMENT_LABEL: Record<StyleSettlement, string> = {
  COLLECT: "Customer pays the difference",
  STORE_CREDIT: "Difference given as store credit",
  NO_REFUND: "No refund (customer agreed)",
  MANUAL_REFUND: "Refunded by the team outside LoopD2C",
};

export type StyleItem = { quantity: number; replacementVariantId?: string | null; replacementUnitPricePaise?: number | null; originalUnitPricePaise?: number | null };

// Replacement value minus what was paid, over items with a different style.
export function styleDifferencePaise(items: StyleItem[]): number | null {
  const changed = items.filter((item) => item.replacementVariantId);
  if (!changed.length) return null;
  return changed.reduce((sum, item) => sum + ((item.replacementUnitPricePaise ?? 0) - (item.originalUnitPricePaise ?? 0)) * Math.max(1, item.quantity || 1), 0);
}

export function settlementOptions(difference: number | null): StyleSettlement[] {
  if (!difference) return [];
  return difference > 0 ? ["COLLECT"] : ["STORE_CREDIT", "NO_REFUND", "MANUAL_REFUND"];
}

type RequestState = { status: string; styleSettledAt?: Date | string | null; forwardAwb?: string | null; stylePaymentPaid?: boolean };

export function styleChangeBlocker(input: RequestState): string | null {
  if (["REPLACEMENT_SHIPPED", "CLOSED", "REJECTED"].includes(input.status) || input.forwardAwb) return "The replacement has already been booked.";
  if (input.styleSettledAt || input.stylePaymentPaid) return "The price difference is already settled, so the style is locked.";
  return null;
}

// What stops "Create replacement shipment" for a different-style exchange.
export function styleReplacementBlocker(input: { difference: number | null; settlement?: string | null; settledAt?: Date | string | null }): string | null {
  if (!input.difference) return null;
  if (input.difference > 0 && !input.settledAt) return "The customer hasn't paid the price difference for the new style yet.";
  if (input.difference < 0 && !input.settledAt) return "Choose how to settle the price difference for the new style first.";
  return null;
}

export function isSettlementAllowed(settlement: string, difference: number | null): settlement is StyleSettlement {
  return (settlementOptions(difference) as string[]).includes(settlement);
}

export function amountToPaise(amount: string | number | null | undefined): number | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}
