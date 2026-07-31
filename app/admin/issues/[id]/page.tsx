import { prisma } from "../../../../services/db/prisma";
import { ISSUE_ALLOWED_STATUS_TRANSITIONS, getIssueRefundMode } from "../../../../services/exchange/issue";
import IssueLifecycleControls from "./IssueLifecycleControls";

export const dynamic = "force-dynamic";

function statusBadgeVariant(status: string) {
  const s = (status || "").toUpperCase();
  if (["APPROVED", "COMPLETED", "RETURN_RECEIVED"].includes(s)) return "success";
  if (["REJECTED", "CANCELLED", "FAILED"].includes(s)) return "danger";
  if (["OPEN", "PENDING", "AWAITING_CUSTOMER", "AWAITING_APPROVAL", "AWAITING_PAYMENT"].includes(s)) return "warning";
  return "neutral";
}

function getIssueMeta(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object") return null;
  return snapshot as {
    declarations?: {
      declaredUnused?: boolean;
      declaredUnwashed?: boolean;
      declaredTagsIntact?: boolean;
    };
    evidence?: {
      imageEvidenceUrls?: string[];
      videoEvidenceUrls?: string[];
    };
    paymentGatewayName?: string;
  };
}

export default async function AdminIssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const request = await prisma.orderActionRequest.findFirst({
    where: { id, requestType: "ISSUE" },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "desc" } },
      refundRequests: {
        where: { source: "ISSUE_REQUEST" },
        orderBy: { createdAt: "desc" },
        include: { walletTransaction: true },
      },
    },
  });

  if (!request) {
    return (
      <div className="mk-page">
        <div className="mk-empty"><p className="mk-empty-title">Issue request not found</p></div>
      </div>
    );
  }

  const nextTransitions = ISSUE_ALLOWED_STATUS_TRANSITIONS[request.status] || [];
  const issueMeta = getIssueMeta(request.items[0]?.eligibilitySnapshot);
  const refundMode = getIssueRefundMode(issueMeta?.paymentGatewayName);
  const linkedRefund = request.refundRequests[0] || null;

  return (
    <div className="mk-page">
      <div className="mk-page-header">
        <div>
          <h1 className="mk-page-title">Issue / Return Exception Request {request.id}</h1>
          <p className="mk-page-subtitle">Order {request.orderNumber || "—"}</p>
        </div>
        <span className={`mk-badge mk-badge-${statusBadgeVariant(request.status)}`}>{request.status}</span>
      </div>

      <section className="mk-card">
        <h3 className="mk-section-title">Request Summary</h3>
        <p className="mk-list-subtitle">Status: {request.status}</p>
        <p className="mk-list-subtitle">Allowed Next Statuses: {nextTransitions.length ? nextTransitions.join(", ") : "None (terminal)"}</p>
        <p className="mk-list-subtitle">Requested At: {request.requestedAt.toISOString()}</p>
        <p className="mk-list-subtitle">Last Updated: {request.updatedAt.toISOString()}</p>
        <p className="mk-list-subtitle">Request Type: {request.requestType}</p>
        <p className="mk-list-subtitle">Issue Reason: {request.reason || "-"}</p>
        <p className="mk-list-subtitle">Customer Description: {request.customerNote || "-"}</p>
        <p className="mk-list-subtitle">Admin Note: {request.adminNote || "-"}</p>
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Customer Summary</h3>
        <p className="mk-list-subtitle">Name: {request.customerNameSnapshot || "-"}</p>
        <p className="mk-list-subtitle">Phone: {request.customerPhoneSnapshot || "-"}</p>
        <p className="mk-list-subtitle">Email: {request.customerEmailSnapshot || "-"}</p>
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Order / Policy Summary</h3>
        <p className="mk-list-subtitle">Order Number: {request.orderNumber}</p>
        <p className="mk-list-subtitle">Order Amount: {request.orderAmountSnapshot || "-"}</p>
        <p className="mk-list-subtitle">Delivery Date Snapshot: {request.deliveryDateSnapshot?.toISOString() || "-"}</p>
        <p className="mk-list-subtitle">Refund Mode Suggestion: {refundMode}</p>
        <p className="mk-list-subtitle">Declaration - Unused: {issueMeta?.declarations?.declaredUnused ? "Yes" : "No"}</p>
        <p className="mk-list-subtitle">Declaration - Unwashed: {issueMeta?.declarations?.declaredUnwashed ? "Yes" : "No"}</p>
        <p className="mk-list-subtitle">Declaration - Tags Intact: {issueMeta?.declarations?.declaredTagsIntact ? "Yes" : "No"}</p>
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Issue Lifecycle / Store Credit</h3>
        <p className="mk-list-subtitle">Issue Approved: {["APPROVED", "RETURN_RECEIVED", "CLOSED"].includes(request.status) ? "Yes" : "No"}</p>
        <p className="mk-list-subtitle">Return Received: {["RETURN_RECEIVED", "CLOSED"].includes(request.status) ? "Yes" : "No"}</p>
        <p className="mk-list-subtitle">Linked Refund Request: {linkedRefund?.id || "-"}</p>
        <p className="mk-list-subtitle">Refund Method: {linkedRefund?.method || "-"}</p>
        <p className="mk-list-subtitle">Refund / Store Credit Status: {linkedRefund?.status || "-"}</p>
        <p className="mk-list-subtitle">Store Credit Issued: {linkedRefund?.walletTransactionId ? "Yes" : "No"}</p>
        <p className="mk-list-subtitle">Wallet Transaction: {linkedRefund?.walletTransactionId || "-"}</p>
      </section>

      <section className="mk-card">
        <h3 className="mk-section-title">Evidence</h3>
        <p className="mk-label" style={{ marginTop: 8 }}>Image Proof</p>
        <ul className="mk-list-subtitle" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {(issueMeta?.evidence?.imageEvidenceUrls || []).map((url) => (
            <li key={url} style={{ wordBreak: "break-all" }}>{url}</li>
          ))}
          {!(issueMeta?.evidence?.imageEvidenceUrls || []).length ? <li>No image URLs submitted.</li> : null}
        </ul>
        <p className="mk-label" style={{ marginTop: 12 }}>Video / Unboxing Proof</p>
        <ul className="mk-list-subtitle" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
          {(issueMeta?.evidence?.videoEvidenceUrls || []).map((url) => (
            <li key={url} style={{ wordBreak: "break-all" }}>{url}</li>
          ))}
          {!(issueMeta?.evidence?.videoEvidenceUrls || []).length ? <li>No video URLs submitted.</li> : null}
        </ul>
      </section>

      <IssueLifecycleControls
        requestId={request.id}
        currentStatus={request.status}
        allowedTransitions={nextTransitions}
        currentAdminNote={request.adminNote || ""}
      />
    </div>
  );
}
