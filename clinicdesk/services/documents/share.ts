import { clinicScope } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { hashToken, randomToken } from "@/lib/ids";

/**
 * Expiring, individually revocable links for sending a document to a patient.
 *
 * The token is stored hashed, so a database read never yields a working link,
 * and each link can be revoked on its own — pulling one shared summary must not
 * mean rotating the signing secret and breaking every other outstanding link.
 */
export async function createShareLink(params: {
  clinicId: string;
  documentId: string;
  expiresInDays?: number;
  actorStaffUserId?: string | null;
}) {
  const db = clinicScope(params.clinicId);

  const doc = await db.clinicalDocument.findFirst({
    where: { id: params.documentId },
    select: { id: true, status: true, patientId: true },
  });
  if (!doc) throw new Error("Document not found.");
  if (doc.status === "DRAFT") {
    throw new Error("Finalise the document before sharing it.");
  }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + (params.expiresInDays ?? 30) * 86_400_000);

  await db.documentShareLink.create({
    data: { clinicId: params.clinicId, documentId: doc.id, tokenHash: hashToken(token), expiresAt },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "SHARE",
    resourceType: "ClinicalDocument",
    resourceId: doc.id,
    patientId: doc.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
  });

  return { token, expiresAt };
}

/** Resolves a share token. Returns null for unknown, expired or revoked links. */
export async function resolveShareToken(token: string) {
  const { prisma } = await import("@/lib/db");
  const link = await prisma.documentShareLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { document: { select: { id: true, clinicId: true, status: true, patientId: true } } },
  });
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt.getTime() < Date.now()) return null;

  await prisma.documentShareLink.update({
    where: { id: link.id },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  });

  await recordAudit({
    clinicId: link.document.clinicId,
    action: "VIEW",
    resourceType: "ClinicalDocument",
    resourceId: link.document.id,
    patientId: link.document.patientId,
    actorLabel: "share-link",
  });

  return link.document;
}

export async function revokeShareLink(clinicId: string, linkId: string) {
  const db = clinicScope(clinicId);
  await db.documentShareLink.updateMany({
    where: { id: linkId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
