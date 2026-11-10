// Shipping the replacement before the returned item reaches the warehouse, for when
// the courier is slow with the return and the customer has waited long enough.
// Team-only, never automatic, and only once Delhivery has picked the return up (so
// the item has left the customer). The reason is kept; the return keeps being
// tracked after the exchange closes, and the team is alerted if it goes back to the
// customer or is cancelled.

export const EARLY_REPLACEMENT_MIN_REASON = 5;

type ReverseShipment = { status?: string | null; awb?: string | null } | null | undefined;

export function earlyReplacementEligibility(input: { status: string; earlyReplacementAt?: Date | string | null; reverseShipment: ReverseShipment; forwardAwb?: string | null }): { ok: true } | { ok: false; reason: string } {
  if (input.earlyReplacementAt) return { ok: false, reason: "The replacement is already cleared to ship early." };
  if (input.forwardAwb) return { ok: false, reason: "The replacement is already booked." };
  if (["ITEM_RECEIVED", "REPLACEMENT_PROCESSING", "REPLACEMENT_SHIPPED", "CLOSED", "REJECTED"].includes(input.status)) return { ok: false, reason: "Not needed at this step." };
  const reverse = input.reverseShipment;
  const pickedUp = input.status === "PICKUP_COMPLETED" || (input.status === "PICKUP_SCHEDULED" && reverse?.status === "IN_TRANSIT");
  if (!pickedUp) return { ok: false, reason: "Only after Delhivery has picked up the return." };
  if (reverse?.status === "FAILED") return { ok: false, reason: "The return pickup failed or was cancelled." };
  return { ok: true };
}

// Whether a closed or shipped exchange is still waiting for its return.
export function returnOutstanding(input: { earlyReplacementAt?: Date | string | null; reverseShipment: ReverseShipment }) {
  return Boolean(input.earlyReplacementAt) && input.reverseShipment?.status !== "DELIVERED";
}
