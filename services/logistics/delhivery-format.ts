// Delhivery expects a bare 10-digit Indian mobile number — not E.164. Order
// shipping phones from Shopify are stored as "+9198...", which makes Delhivery's
// CMU API throw a generic internal error. Strip to the last 10 digits.
export function toDelhiveryPhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

// Delhivery expects a 6-digit numeric pincode.
export function toDelhiveryPincode(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(0, 6);
}
