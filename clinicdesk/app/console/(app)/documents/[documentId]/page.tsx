import Link from "next/link";
import { notFound } from "next/navigation";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { aiDraftEnabled } from "@/services/documents/ai-draft";
import { SEED_TEMPLATES } from "@/services/documents/default-templates";
import type { DocumentData, TemplateField } from "@/services/documents/template";
import { DocumentEditor } from "@/components/documents/document-editor";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);

  const doc = await db.clinicalDocument.findFirst({
    where: { id: documentId },
    include: {
      patient: { select: { id: true, fullName: true, patientNo: true } },
      template: { select: { fields: true } },
    },
  });
  if (!doc) notFound();

  await recordAudit({
    clinicId: session.clinicId,
    action: "VIEW",
    resourceType: "ClinicalDocument",
    resourceId: doc.id,
    patientId: doc.patientId,
    actorStaffUserId: session.staffUserId,
  });

  // A document whose template was deleted still has to open, so fall back to
  // the starter field set for its type rather than rendering an empty editor.
  const fields = (doc.template?.fields as unknown as TemplateField[] | undefined) ??
    SEED_TEMPLATES.find((template) => template.type === doc.type)?.fields ??
    [];

  return (
    <div>
      <Link
        href={`/console/patients/${doc.patient.id}`}
        className="mb-3 inline-block text-sm text-ink-faint hover:text-ink"
      >
        ← {doc.patient.fullName}
      </Link>
      <DocumentEditor
        documentId={doc.id}
        title={doc.title}
        status={doc.status}
        documentNo={doc.documentNo}
        fields={fields}
        initialData={(doc.data ?? {}) as DocumentData}
        patientName={`${doc.patient.fullName} · ${doc.patient.patientNo}`}
        hasEpisode={Boolean(doc.episodeId)}
        aiEnabled={aiDraftEnabled()}
      />
    </div>
  );
}
