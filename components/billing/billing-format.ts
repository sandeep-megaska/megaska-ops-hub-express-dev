export function formatBillingMoney({ amount, currency, locale = "en-US" }: { amount: string; currency: string; locale?: string }) {
  try {
    // Number is used only by Intl presentation; the source decimal string remains the DTO value.
    const numeric = Number(amount);
    if (!Number.isFinite(numeric)) throw new Error("invalid amount");
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(numeric);
  } catch { return `${amount} ${currency}`; }
}

export function formatBillingQuantity(quantity: string) {
  const value = quantity.trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(value)) return value;
  const sign = value.startsWith("-") ? "-" : "";
  const unsigned = value.replace(/^[+-]/, "");
  const [integer, fraction] = unsigned.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFraction = fraction?.replace(/0+$/, "");
  return `${sign}${grouped}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

export function usageProgress(used: string, included: string) {
  const usedNumber = Number(used); const includedNumber = Number(included);
  if (!Number.isFinite(usedNumber) || !Number.isFinite(includedNumber) || includedNumber <= 0) return { label: "No included allowance", value: 0 };
  const ratio = Math.max(0, Math.min(100, (usedNumber / includedNumber) * 100));
  return { value: ratio, label: usedNumber > includedNumber ? "Over allowance" : usedNumber === includedNumber ? "Allowance reached" : "Within allowance" };
}
