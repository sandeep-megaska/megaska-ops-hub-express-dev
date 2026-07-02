import { prisma } from "../../../../services/db/prisma";
import { ISSUE_ALLOWED_STATUS_TRANSITIONS, getIssueRefundMode } from "../../../../services/exchange/issue";
import IssueLifecycleControls from "./IssueLifecycleControls";

export const dynamic = "force-dynamic";

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
    return <main style={{ padding: 24 }}>Issue request not found.</main>;
  }

  const nextTransitions = ISSUE_ALLOWED_STATUS_TRANSITIONS[request.status] || [];
  const issueMeta = getIssueMeta(request.items[0]?.eligibilitySnapshot);
  const refundMode = getIssueRefundMode(issueMeta?.paymentGatewayName);
  const linkedRefund = request.refundRequests[0] || null;

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1>Issue / Return Exception Request {request.id}</h1>

      <section>
        <h3>Request Summary</h3>
        <p>Status: {request.status}</p>
        <p>Allowed Next Statuses: {nextTransitions.length ? nextTransitions.join(", ") : "None (terminal)"}</p>
        <p>Requested At: {request.requestedAt.toISOString()}</p>
        <p>Last Updated: {request.updatedAt.toISOString()}</p>
        <p>Request Type: {request.requestType}</p>
        <p>Issue Reason: {request.reason || "-"}</p>
        <p>Customer Description: {request.customerNote || "-"}</p>
        <p>Admin Note: {request.adminNote || "-"}</p>
      </section>

      <section>
        <h3>Customer Summary</h3>
        <p>Name: {request.customerNameSnapshot || "-"}</p>
        <p>Phone: {request.customerPhoneSnapshot || "-"}</p>
        <p>Email: {request.customerEmailSnapshot || "-"}</p>
      </section>

      <section>
        <h3>Order / Policy Summary</h3>
        <p>Order Number: {request.orderNumber}</p>
        <p>Order Amount: {request.orderAmountSnapshot || "-"}</p>
        <p>Delivery Date Snapshot: {request.deliveryDateSnapshot?.toISOString() || "-"}</p>
        <p>Refund Mode Suggestion: {refundMode}</p>
        <p>Declaration - Unused: {issueMeta?.declarations?.declaredUnused ? "Yes" : "No"}</p>
        <p>Declaration - Unwashed: {issueMeta?.declarations?.declaredUnwashed ? "Yes" : "No"}</p>
        <p>Declaration - Tags Intact: {issueMeta?.declarations?.declaredTagsIntact ? "Yes" : "No"}</p>
      </section>


      <section>
        <h3>Issue Lifecycle / Store Credit</h3>
        <p>Issue Approved: {["APPROVED", "RETURN_RECEIVED", "CLOSED"].includes(request.status) ? "Yes" : "No"}</p>
        <p>Return Received: {["RETURN_RECEIVED", "CLOSED"].includes(request.status) ? "Yes" : "No"}</p>
        <p>Linked Refund Request: {linkedRefund?.id || "-"}</p>
        <p>Refund Method: {linkedRefund?.method || "-"}</p>
        <p>Refund / Store Credit Status: {linkedRefund?.status || "-"}</p>
        <p>Store Credit Issued: {linkedRefund?.walletTransactionId ? "Yes" : "No"}</p>
        <p>Wallet Transaction: {linkedRefund?.walletTransactionId || "-"}</p>
      </section>

      <section>
        <h3>Evidence</h3>
        <p>Image Proof:</p>
        <ul>
          {(issueMeta?.evidence?.imageEvidenceUrls || []).map((url) => (
            <li key={url}>{url}</li>
          ))}
          {!(issueMeta?.evidence?.imageEvidenceUrls || []).length ? <li>No image URLs submitted.</li> : null}
        </ul>
        <p>Video / Unboxing Proof:</p>
        <ul>
          {(issueMeta?.evidence?.videoEvidenceUrls || []).map((url) => (
            <li key={url}>{url}</li>
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
    </main>
  );
}
