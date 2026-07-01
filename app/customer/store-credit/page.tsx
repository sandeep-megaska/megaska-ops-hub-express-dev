"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type StoreCreditBalance = {
  balance: number;
  currency: "INR";
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

export default function CustomerStoreCreditPage() {
  const [balance, setBalance] = useState<StoreCreditBalance>({ balance: 0, currency: "INR" });
  const [transactions, setTransactions] = useState<StoreCreditTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [balanceResponse, transactionsResponse] = await Promise.all([
          fetch("/api/customer/store-credit", { cache: "no-store" }),
          fetch("/api/customer/store-credit/transactions", { cache: "no-store" }),
        ]);

        const balanceData = await balanceResponse.json().catch(() => ({}));
        const transactionsData = await transactionsResponse.json().catch(() => []);

        if (!balanceResponse.ok || !transactionsResponse.ok) {
          if (balanceResponse.status === 401 || transactionsResponse.status === 401) {
            setError("Please log in with OTP to view your Megaska Store Credit.");
          } else {
            setError(balanceData?.error || "Unable to load Megaska Store Credit right now.");
          }
          setLoading(false);
          return;
        }

        setBalance({
          balance: Number(balanceData?.balance || 0),
          currency: balanceData?.currency === "INR" ? "INR" : "INR",
        });
        setTransactions(Array.isArray(transactionsData) ? transactionsData : []);
        setLoading(false);
      } catch {
        setError("Unable to load Megaska Store Credit right now.");
        setLoading(false);
      }
    })();
  }, []);

  return (
    <main style={{ padding: 24, display: "grid", gap: 18, maxWidth: 920, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <Link href="/apps/megaska/dashboard">← Back to dashboard</Link>
      <header>
        <h1>Megaska Store Credit</h1>
        <p>Store Credit can be used for future Megaska purchases once checkout redemption is enabled.</p>
      </header>

      {loading ? <p>Loading Megaska Store Credit…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {!loading && !error ? (
        <>
          <section style={{ border: "1px solid #ddd", borderRadius: 12, padding: 20, background: "#fafafa" }}>
            <h2 style={{ marginTop: 0 }}>Available Store Credit</h2>
            <p style={{ fontSize: 34, fontWeight: 700, margin: 0 }}>{formatInr(balance.balance)}</p>
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
            <h2 style={{ marginTop: 0 }}>About Megaska Store Credit</h2>
            <p>Megaska Store Credit is issued for approved COD refund settlements and eligible admin-approved refund cases.</p>
            <p>Store Credit:</p>
            <ul>
              <li>Can be used for future Megaska purchases</li>
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
