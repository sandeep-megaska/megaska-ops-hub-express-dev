// Pure copy/formatting for store-credit emails. Kept deliberately import-free so it can
// be unit-tested directly without loading the email transport or Prisma, and so the same
// helpers back both the ledger-credit notification and the gift-card code email.

export function firstName(name?: string | null) {
  return String(name || "").trim().split(/\s+/)[0] || "there";
}

export function formatAmount(amountMinor: number, currency: string) {
  const amount = (Number(amountMinor || 0) / 100).toFixed(2);
  return `${currency} ${amount}`;
}

// The customer's store credit lives on a Shopify gift card so it can be spent at native
// checkout. This body hands them the code + redeemable balance so they don't have to
// return to the dashboard to copy it.
export function buildGiftCardCodeText(payload: { customerName?: string | null; code: string; balanceMinor: number; currency: string }) {
  return [
    `Hi ${firstName(payload.customerName)},`,
    "",
    'Here is your store credit code. Enter it in the "Gift card" field at checkout to spend your balance:',
    "",
    `    ${payload.code}`,
    "",
    `Available to use at checkout: ${formatAmount(payload.balanceMinor, payload.currency)}`,
    "",
    "Your balance stays on this code — use it across as many orders as you like until it runs out.",
    "",
    "Store Credit Team",
  ].join("\n");
}
