"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

type PayoutDetails = {
  rail: "UPI" | "BANK";
  accountHolderName?: string | null;
  bankAccountMasked?: string | null;
  bankIfscMasked?: string | null;
  upiIdMasked?: string | null;
};

type RefundDetail = {
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  reason: string | null;
  createdAt: string;
  payoutDetails?: PayoutDetails | null;
};

const statusText: Record<string, string> = {
  DETAILS_SUBMITTED: "Refund payout details submitted.",
  APPROVED: "Refund approved.",
  PAID: "Refund paid.",
};

export default function CustomerRefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [refundId, setRefundId] = useState<string>("");
  const [item, setItem] = useState<RefundDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rail, setRail] = useState<"UPI" | "BANK">("UPI");
  const [upiId, setUpiId] = useState("");
  const [accountHolderName, setAccountHolderName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");

  useEffect(() => {
    void params.then((v) => setRefundId(v.id));
  }, [params]);

  async function load(id: string) {
    const response = await fetch(`/api/account/refunds/${id}`, { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data?.error || "Failed to load refund");
      setLoading(false);
      return;
    }
    setItem(data);
    setLoading(false);
  }

  useEffect(() => {
    if (!refundId) return;
    void load(refundId);
  }, [refundId]);

  const canSubmitDetails = useMemo(() => item?.status === "DETAILS_PENDING" && item?.method === "COD", [item]);

  async function submitPayoutDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!item) return;
    setError(null);
    setSuccess(null);

    if (rail === "UPI" && !upiId.trim()) {
      setError("UPI ID is required.");
      return;
    }

    if (rail === "BANK") {
      if (!accountHolderName.trim() || !accountNumber.trim() || !confirmAccountNumber.trim() || !ifsc.trim()) {
        setError("All bank fields are required.");
        return;
      }
      if (accountNumber.trim() !== confirmAccountNumber.trim()) {
        setError("Account number confirmation must match.");
        return;
      }
    }

    setSaving(true);
    const payload = rail === "UPI"
      ? { rail: "UPI", upiId: upiId.trim() }
      : { rail: "BANK", accountHolderName: accountHolderName.trim(), accountNumber: accountNumber.trim(), confirmAccountNumber: confirmAccountNumber.trim(), ifsc: ifsc.trim() };

    const response = await fetch(`/api/account/refunds/${item.id}/payout-details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(data?.error || "Failed to submit payout details");
      setSaving(false);
      return;
    }

    setSuccess("Payout details submitted.");
    setSaving(false);
    await load(item.id);
  }

  return <main style={{ padding: 24, display: "grid", gap: 16 }}>
    <h1>Refund Details</h1>
    {loading ? <p>Loading…</p> : null}
    {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
    {success ? <p style={{ color: "green" }}>{success}</p> : null}
    {item ? <>
      <section>
        <p><strong>Refund ID:</strong> {item.id}</p>
        <p><strong>Amount:</strong> {item.amount} {item.currency}</p>
        <p><strong>Status:</strong> {item.status}</p>
        <p><strong>Reason:</strong> {item.reason || "-"}</p>
        <p><strong>Requested:</strong> {new Date(item.createdAt).toLocaleString()}</p>
      </section>

      {item.payoutDetails ? <section>
        <h3>Submitted payout details</h3>
        <p><strong>Rail:</strong> {item.payoutDetails.rail}</p>
        <p><strong>Account holder:</strong> {item.payoutDetails.accountHolderName || "-"}</p>
        <p><strong>Bank account:</strong> {item.payoutDetails.bankAccountMasked || "-"}</p>
        <p><strong>IFSC:</strong> {item.payoutDetails.bankIfscMasked || "-"}</p>
        <p><strong>UPI ID:</strong> {item.payoutDetails.upiIdMasked || "-"}</p>
      </section> : null}

      {canSubmitDetails ? <form onSubmit={submitPayoutDetails} style={{ display: "grid", gap: 10, maxWidth: 480 }}>
        <h3>Submit payout details</h3>
        <label>
          Payout method
          <select value={rail} onChange={(e) => setRail(e.target.value as "UPI" | "BANK")}>
            <option value="UPI">UPI</option>
            <option value="BANK">Bank Transfer</option>
          </select>
        </label>
        {rail === "UPI" ? <label>
          UPI ID
          <input value={upiId} onChange={(e) => setUpiId(e.target.value)} placeholder="name@upi" />
        </label> : null}
        {rail === "BANK" ? <>
          <label>Account holder name<input value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} /></label>
          <label>Account number<input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></label>
          <label>Confirm account number<input value={confirmAccountNumber} onChange={(e) => setConfirmAccountNumber(e.target.value)} /></label>
          <label>IFSC<input value={ifsc} onChange={(e) => setIfsc(e.target.value)} /></label>
        </> : null}
        <button type="submit" disabled={saving}>{saving ? "Submitting…" : "Submit details"}</button>
      </form> : null}

      {!canSubmitDetails ? <p>{statusText[item.status] || "No action required."}</p> : null}
    </> : null}
  </main>;
}
