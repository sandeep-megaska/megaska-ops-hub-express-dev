import { requireStaff } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { renderDocument, DocumentError } from "@/services/documents/documents";
import { renderPdf } from "@/services/documents/pdf";

export const maxDuration = 60;

/**
 * The printable PDF.
 *
 * `?disposition=attachment` downloads; the default opens inline so she can hit
 * Ctrl+P straight from the browser, which is how the document actually reaches
 * the patient today.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  const session = await requireStaff();

  try {
    const { html, doc, letterhead } = await renderDocument(session.clinicId, documentId);

    const pdf = await renderPdf({
      html,
      letterhead,
      clinicName: doc.clinic.name,
      patientName: doc.patient.fullName,
      patientNo: doc.patient.patientNo,
      documentTitle: doc.title,
      documentNo: doc.documentNo,
    });

    await recordAudit({
      clinicId: session.clinicId,
      action: "EXPORT",
      resourceType: "ClinicalDocument",
      resourceId: doc.id,
      patientId: doc.patientId,
      actorStaffUserId: session.staffUserId,
    });

    const disposition =
      new URL(request.url).searchParams.get("disposition") === "attachment"
        ? "attachment"
        : "inline";
    const safeName = `${doc.documentNo ?? doc.title}`.replace(/[^\w.-]+/g, "-");

    return new Response(pdf as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${disposition}; filename="${safeName}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DocumentError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("[documents] pdf failed", error);
    return Response.json({ error: "Couldn't render the PDF." }, { status: 500 });
  }
}
