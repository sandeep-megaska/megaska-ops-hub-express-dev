"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StoreCreditBalance = {
  balance: number;
  currency: "INR";
};

type StoreCreditGiftCard = {
  present: boolean;
  code?: string | null;
  last4?: string;
  balance?: number;
};

type StoreCreditTransaction = {
  id: string;
  type: string;
  customerLabel: string;
  amount: number;
  direction: "credit" | "debit" | "neutral";
  reason: string | null;
  refundRequestId?: string | null;
  orderName?: string | null;
  createdAt: string;
};


function formatInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatSignedAmount(transaction: StoreCreditTransaction) {
  const prefix = transaction.direction === "credit" ? "+" : transaction.direction === "debit" ? "-" : "";
  return `${prefix}${formatInr(transaction.amount)}`;
}

export default function StoreCreditClient() {
  const [balance, setBalance] = useState<StoreCreditBalance>({ balance: 0, currency: "INR" });
  const [giftCard, setGiftCard] = useState<StoreCreditGiftCard>({ present: false });
  const [transactions, setTransactions] = useState<StoreCreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [balanceResponse, transactionsResponse, giftCardResponse] = await Promise.all([
          fetch("/api/customer/store-credit", { cache: "no-store" }),
          fetch("/api/customer/store-credit/transactions", { cache: "no-store" }),
          fetch("/api/customer/store-credit/gift-card", { cache: "no-store" }),
        ]);

        const balanceData = await balanceResponse.json().catch(() => ({}));
        const transactionsData = await transactionsResponse.json().catch(() => []);
        const giftCardData = await giftCardResponse.json().catch(() => ({ present: false }));

        if (!balanceResponse.ok || !transactionsResponse.ok) {
          if (balanceResponse.status === 401 || transactionsResponse.status === 401) {
            setError("Please log in with OTP to view your Store Credit.");
          } else {
            setError(balanceData?.error || "Unable to load Store Credit right now.");
          }
          setLoading(false);
          return;
        }

        setBalance({
          balance: Number(balanceData?.balance || 0),
          currency: balanceData?.currency === "INR" ? "INR" : "INR",
        });
        setTransactions(Array.isArray(transactionsData) ? transactionsData : []);
        setGiftCard(
          giftCardData && giftCardData.present
            ? { present: true, code: giftCardData.code ?? null, last4: giftCardData.last4, balance: Number(giftCardData.balance || 0) }
            : { present: false },
        );
        setLoading(false);
      } catch {
        setError("Unable to load Store Credit right now.");
        setLoading(false);
      }
    })();
  }, []);

  async function copyCode() {
    if (!giftCard.code) return;
    try {
      await navigator.clipboard.writeText(giftCard.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main style={{ padding: 24, display: "grid", gap: 18, maxWidth: 920, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <Link href="/apps/loopd2c/account">← Back to dashboard</Link>
      <header>
        <h1>Store Credit</h1>
        <p>Spend your store credit at checkout — enter your code in the &ldquo;Gift card&rdquo; field to apply it to any order.</p>
      </header>

      {loading ? <p>Loading Store Credit…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {!loading && !error ? (
        <>
          {giftCard.present && giftCard.code ? (
            <section style={{ border: "1px solid #cbd5ff", borderRadius: 12, padding: 20, background: "#f4f7ff", display: "grid", gap: 12 }}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>Use your store credit at checkout</h2>
              <p style={{ margin: 0, color: "#334" }}>
                {typeof giftCard.balance === "number"
                  ? `${formatInr(giftCard.balance)} available. `
                  : ""}
                Enter this code in the &ldquo;Gift card&rdquo; field on the checkout page:
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                <code
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    letterSpacing: 1,
                    padding: "10px 14px",
                    background: "#fff",
                    border: "1px dashed #9db0ff",
                    borderRadius: 8,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {giftCard.code}
                </code>
                <button
                  type="button"
                  onClick={copyCode}
                  style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #4560d8", background: copied ? "#087f23" : "#4560d8", color: "#fff", cursor: "pointer", fontWeight: 600 }}
                >
                  {copied ? "Copied ✓" : "Copy code"}
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 13, color: "#667" }}>
                Your balance stays on this code — reuse it across orders until it runs out.
              </p>
            </section>
          ) : null}

          <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20, background: "#fafafa" }}>
            <h2 style={{ marginTop: 0 }}>Available Store Credit</h2>
            <p style={{ fontSize: 34, fontWeight: 700, margin: 0 }}>
              {giftCard.present && typeof giftCard.balance === "number" ? formatInr(giftCard.balance) : formatInr(balance.balance)}
            </p>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20 }}>
            <h2 style={{ marginTop: 0 }}>Store Credit History</h2>
            {transactions.length === 0 ? <p>You do not have any Store Credit yet.</p> : null}
            {transactions.length > 0 ? (
              <div style={{ display: "grid", gap: 12 }}>
                {transactions.map((transaction) => (
                  <article key={transaction.id} style={{ borderTop: "1px solid #eee", paddingTop: 12, display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <strong>{transaction.customerLabel}</strong>
                      <strong style={{ color: transaction.direction === "credit" ? "#087f23" : transaction.direction === "debit" ? "#b00020" : "#333" }}>
                        {formatSignedAmount(transaction)}
                      </strong>
                    </div>
                    {transaction.reason ? <span>{transaction.reason}</span> : null}
                    {transaction.orderName || transaction.refundRequestId ? (
                      <span style={{ color: "#555" }}>
                        {transaction.orderName ? `Order/reference: ${transaction.orderName}` : ""}
                        {transaction.orderName && transaction.refundRequestId ? " · " : ""}
                        {transaction.refundRequestId ? `Refund: ${transaction.refundRequestId}` : ""}
                      </span>
                    ) : null}
                    <time style={{ color: "#666" }}>{new Date(transaction.createdAt).toLocaleString()}</time>
                  </article>
                ))}
              </div>
            ) : null}
          </section>

          <section style={{ border: "1px solid #d9e2ff", borderRadius: 12, padding: 20, background: "#f6f8ff" }}>
            <h2 style={{ marginTop: 0 }}>About Store Credit</h2>
            <p>Store Credit is issued for approved COD refund settlements and eligible admin-approved refund cases.</p>
            <p>Store Credit:</p>
            <ul>
              <li>Can be used at checkout — enter your code in the &ldquo;Gift card&rdquo; field</li>
              <li>Cannot be withdrawn as cash</li>
              <li>Cannot be transferred</li>
              <li>Cannot be gifted</li>
              <li>Cannot be converted to bank, UPI, or cash refund</li>
            </ul>
          </section>
        </>
      ) : null}
    </main>
  );
}
