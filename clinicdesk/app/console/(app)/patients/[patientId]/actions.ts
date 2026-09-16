"use server";

import { redirect } from "next/navigation";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { createDocument, duplicateFromDocument } from "@/services/documents/documents";

/**
 * Starts a new clinical document.
 *
 * `sourceDocumentId` is the pilot's real workflow made safe: she opens a
 * previous patient's summary and edits it. Copying it forward drops the fields
 * that belong to the other patient, which is precisely the mistake the
 * copy-paste habit produces.
 */
export async function startDocument(formData: FormData) {
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);

  const patientId = String(formData.get("patientId") ?? "");
  const episodeId = String(formData.get("episodeId") ?? "") || null;
  const sourceDocumentId = String(formData.get("sourceDocumentId") ?? "") || null;

  const practitionerId =
    session.practitionerId ??
    (await db.practitioner.findFirst({ where: { isBookable: true }, select: { id: true } }))?.id;
  if (!practitionerId) throw new Error("This clinic has no practitioner set up yet.");

  const document = sourceDocumentId
    ? await duplicateFromDocument({
        clinicId: session.clinicId,
        sourceDocumentId,
        patientId,
        episodeId,
        practitionerId,
        actorStaffUserId: session.staffUserId,
      })
    : await createDocument({
        clinicId: session.clinicId,
        patientId,
        episodeId,
        practitionerId,
        type: "DISCHARGE_SUMMARY",
        actorStaffUserId: session.staffUserId,
      });

  redirect(`/console/documents/${document.id}`);
}
