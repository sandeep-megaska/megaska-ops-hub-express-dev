import { clinicScope } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { allocateDocumentNumber } from "./numbering";
import { renderDocumentHtml } from "./render";
import { missingRequiredFields, type DocumentData, type TemplateField } from "./template";
import type { DocumentType, Prisma } from "@/generated/prisma";

export class DocumentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DocumentError";
  }
}

async function loadForRender(clinicId: string, documentId: string) {
  const db = clinicScope(clinicId);
  const doc = await db.clinicalDocument.findFirst({
    where: { id: documentId },
    include: {
      patient: true,
      practitioner: true,
      template: true,
      letterhead: true,
      clinic: true,
      episode: true,
    },
  });
  if (!doc) throw new DocumentError("NOT_FOUND", "Document not found.");

  const letterhead =
    doc.letterhead ??
    (await db.letterhead.findFirst({ where: { isActive: true }, orderBy: { createdAt: "asc" } }));
  if (!letterhead) {
    throw new DocumentError(
      "NO_LETTERHEAD",
      "This clinic has no letterhead configured yet. Add one in Settings → Letterhead.",
    );
  }

  return { doc, letterhead };
}

/** Preview HTML for the live editor pane and for the PDF route. */
export async function renderDocument(clinicId: string, documentId: string) {
  const { doc, letterhead } = await loadForRender(clinicId, documentId);
  const fields = ((doc.template?.fields ?? []) as unknown) as TemplateField[];

  // A finalised document renders from its own snapshot, never from the current
  // template — a later template edit must not rewrite history.
  if (doc.renderedHtml && doc.status !== "DRAFT") {
    return { html: doc.renderedHtml, doc, letterhead };
  }

  const html = renderDocumentHtml({
    clinic: doc.clinic,
    patient: doc.patient,
    practitioner: doc.practitioner,
    document: {
      title: doc.title,
      documentNo: doc.documentNo,
      type: doc.type,
      createdAt: doc.createdAt,
      finalisedAt: doc.finalisedAt,
      status: doc.status,
    },
    letterhead,
    fields,
    data: (doc.data ?? {}) as DocumentData,
    bodyHtml: doc.template?.bodyHtml,
  });

  return { html, doc, letterhead };
}

export async function createDocument(params: {
  clinicId: string;
  patientId: string;
  episodeId?: string | null;
  practitionerId: string;
  type: DocumentType;
  templateId?: string | null;
  title?: string;
  data?: DocumentData;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);

  const template = params.templateId
    ? await db.documentTemplate.findFirst({ where: { id: params.templateId, isActive: true } })
    : await db.documentTemplate.findFirst({
        where: { type: params.type, isActive: true },
        orderBy: { version: "desc" },
      });

  const letterhead = await db.letterhead.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
  });

  const fields = ((template?.fields ?? []) as unknown) as TemplateField[];
  const seeded: DocumentData = { ...(params.data ?? {}) };
  for (const field of fields) {
    if (seeded[field.key] === undefined && field.defaultValue !== undefined) {
      seeded[field.key] = field.defaultValue;
    }
  }

  const doc = await db.clinicalDocument.create({
    data: {
      clinicId: params.clinicId,
      patientId: params.patientId,
      episodeId: params.episodeId ?? null,
      practitionerId: params.practitionerId,
      templateId: template?.id ?? null,
      letterheadId: letterhead?.id ?? null,
      type: params.type,
      title: params.title ?? template?.name ?? "Clinical document",
      data: seeded as Prisma.InputJsonObject,
    },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "CREATE",
    resourceType: "ClinicalDocument",
    resourceId: doc.id,
    patientId: params.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
  });

  return doc;
}

export async function updateDocumentData(params: {
  clinicId: string;
  documentId: string;
  data: DocumentData;
  title?: string;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);
  const existing = await db.clinicalDocument.findFirst({
    where: { id: params.documentId },
    select: { status: true, patientId: true },
  });
  if (!existing) throw new DocumentError("NOT_FOUND", "Document not found.");
  if (existing.status !== "DRAFT") {
    throw new DocumentError(
      "IMMUTABLE",
      "This document is finalised. Create a correction instead of editing it.",
    );
  }

  const doc = await db.clinicalDocument.update({
    where: { id: params.documentId },
    data: {
      data: params.data as Prisma.InputJsonObject,
      ...(params.title ? { title: params.title } : {}),
    },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "UPDATE",
    resourceType: "ClinicalDocument",
    resourceId: doc.id,
    patientId: existing.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
  });

  return doc;
}

/**
 * Locks a document: allocates its number, snapshots the rendered HTML, and
 * marks it immutable. Everything after this point is a new version.
 */
export async function finaliseDocument(params: {
  clinicId: string;
  documentId: string;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);
  const { doc, letterhead } = await loadForRender(params.clinicId, params.documentId);

  if (doc.status !== "DRAFT") {
    throw new DocumentError("ALREADY_FINAL", "This document is already finalised.");
  }

  const fields = ((doc.template?.fields ?? []) as unknown) as TemplateField[];
  const missing = missingRequiredFields(fields, (doc.data ?? {}) as DocumentData);
  if (missing.length > 0) {
    throw new DocumentError("MISSING_FIELDS", `Still blank: ${missing.join(", ")}.`);
  }

  const documentNo = await allocateDocumentNumber(params.clinicId, doc.type, doc.clinic.timezone);
  const finalisedAt = new Date();

  const html = renderDocumentHtml({
    clinic: doc.clinic,
    patient: doc.patient,
    practitioner: doc.practitioner,
    document: {
      title: doc.title,
      documentNo,
      type: doc.type,
      createdAt: doc.createdAt,
      finalisedAt,
      status: "FINALISED",
    },
    letterhead,
    fields,
    data: (doc.data ?? {}) as DocumentData,
    bodyHtml: doc.template?.bodyHtml,
  });

  const updated = await db.clinicalDocument.update({
    where: { id: doc.id },
    data: {
      status: "FINALISED",
      documentNo,
      finalisedAt,
      finalisedById: params.actorStaffUserId ?? null,
      renderedHtml: html,
      letterheadId: letterhead.id,
    },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "FINALISE",
    resourceType: "ClinicalDocument",
    resourceId: doc.id,
    patientId: doc.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
    metadata: { documentNo },
  });

  return updated;
}

/**
 * Issues a correction: a fresh DRAFT pre-filled from the finalised original,
 * linked back to it. The original stays on file and is marked SUPERSEDED once
 * the correction is finalised.
 */
export async function correctDocument(params: {
  clinicId: string;
  documentId: string;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);
  const original = await db.clinicalDocument.findFirst({ where: { id: params.documentId } });
  if (!original) throw new DocumentError("NOT_FOUND", "Document not found.");
  if (original.status === "DRAFT") {
    throw new DocumentError("IS_DRAFT", "This document is still a draft — just edit it.");
  }

  const correction = await db.clinicalDocument.create({
    data: {
      clinicId: params.clinicId,
      patientId: original.patientId,
      episodeId: original.episodeId,
      practitionerId: original.practitionerId,
      templateId: original.templateId,
      letterheadId: original.letterheadId,
      type: original.type,
      title: original.title,
      data: original.data as Prisma.InputJsonObject,
      supersedesId: original.id,
    },
  });

  await db.clinicalDocument.update({
    where: { id: original.id },
    data: { status: "SUPERSEDED" },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "CREATE",
    resourceType: "ClinicalDocument",
    resourceId: correction.id,
    patientId: original.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
    metadata: { supersedes: original.id },
  });

  return correction;
}

/**
 * The pilot's actual workflow: she opens a previous patient's summary and edits
 * it. This does that properly — copies the clinical scaffolding forward while
 * deliberately dropping the fields that are specific to the other patient.
 *
 * Getting this wrong is the exact failure mode of the copy-paste workflow it
 * replaces: another patient's diagnosis left in the document.
 */
export const PATIENT_SPECIFIC_FIELDS = [
  "diagnosis",
  "presenting_complaint",
  "history",
  "assessment_findings",
  "outcome_measures",
  "progress_summary",
  "condition_on_discharge",
];

export async function duplicateFromDocument(params: {
  clinicId: string;
  sourceDocumentId: string;
  patientId: string;
  episodeId?: string | null;
  practitionerId: string;
  actorStaffUserId?: string | null;
  /** Carry the clinical narrative across too. Off by default. */
  includePatientSpecific?: boolean;
}) {
  const db = clinicScope(params.clinicId);
  const source = await db.clinicalDocument.findFirst({
    where: { id: params.sourceDocumentId },
  });
  if (!source) throw new DocumentError("NOT_FOUND", "Source document not found.");

  const sourceData = { ...((source.data ?? {}) as DocumentData) };
  if (!params.includePatientSpecific) {
    for (const key of PATIENT_SPECIFIC_FIELDS) delete sourceData[key];
  }

  return createDocument({
    clinicId: params.clinicId,
    patientId: params.patientId,
    episodeId: params.episodeId ?? null,
    practitionerId: params.practitionerId,
    type: source.type,
    templateId: source.templateId,
    title: source.title,
    data: sourceData,
    actorStaffUserId: params.actorStaffUserId ?? null,
  });
}

/** Recent finalised documents of a type, for the "start from a previous one" picker. */
export async function recentDocumentsForReuse(
  clinicId: string,
  type: DocumentType,
  limit = 8,
) {
  const db = clinicScope(clinicId);
  return db.clinicalDocument.findMany({
    where: { type, status: { in: ["FINALISED", "SUPERSEDED"] } },
    orderBy: { finalisedAt: "desc" },
    take: limit,
    select: {
      id: true,
      title: true,
      documentNo: true,
      finalisedAt: true,
      patient: { select: { fullName: true, patientNo: true } },
    },
  });
}
