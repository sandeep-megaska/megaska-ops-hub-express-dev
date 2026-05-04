"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import RefundActions from "./RefundActions";

function row(label: string, value: string | number | null | undefined) {
  return <p><strong>{label}:</strong> {value || "—"}</p>;
}

export default function AdminRefundDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const response = await fetch(`/api/admin/refunds/${id}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload?.error || "Refund not found");
        return;
      }
      setData(payload);
    })();
  }, [id]);

  if (!id) return <main style={{ padding: 24 }}>Invalid refund id.</main>;
  if (error) return <main style={{ padding: 24 }}>{error}</main>;
  if (!data) return <main style={{ padding: 24 }}>Loading refund…</main>;

  return <main style={{ padding: 24, display: "grid", gap: 16 }}><h1>Refund {data.id}</h1><section><h3>Summary</h3>{row("Status", data.status)}{row("Source", `${data.source}${data.sourceId ? ` (${data.sourceId})` : ""}`)}{row("Method", data.method)}{row("Amount", `${data.amount} ${data.currency}`)}{row("Reason", data.reason)}{row("Customer Note", data.customerNote)}{row("Admin Note", data.adminNote)}{row("Created", data.createdAt)}{row("Updated", data.updatedAt)}</section><section><h3>Masked payout details</h3>{row("Rail", data.payoutDetails?.rail)}{row("Account Holder", data.payoutDetails?.accountHolderName)}{row("Bank Account", data.payoutDetails?.bankAccountMasked)}{row("IFSC", data.payoutDetails?.bankIfscMasked)}{row("UPI", data.payoutDetails?.upiIdMasked)}{row("Phone", data.payoutDetails?.phoneMasked)}</section><RefundActions id={data.id} status={data.status} /></main>;
}
