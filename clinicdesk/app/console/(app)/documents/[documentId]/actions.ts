"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/session";
import { clinicScope } from "@/lib/db";
import {
  correctDocument,
  finaliseDocument,
  updateDocumentData,
  DocumentError,
} from "@/services/documents/documents";
import { createShareLink } from "@/services/documents/share";
import { draftDischargeSummary, AiDraftUnavailable } from "@/services/documents/ai-draft";
import type { DocumentData } from "@/services/documents/template";

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function saveDocument(
  documentId: string,
  data: DocumentData,
  title?: string,
): Promise<ActionResult> {
  const session = await requireStaff();
  try {
    await updateDocumentData({
      clinicId: session.clinicId,
      documentId,
      data,
      title,
      actorStaffUserId: session.staffUserId,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof DocumentError) return { ok: false, error: error.message };
    console.error("[documents] save failed", error);
    return { ok: false, error: "Couldn't save. Your text is still on screen — try again." };
  }
}

export async function finalise(documentId: string): Promise<ActionResult> {
  const session = await requireStaff();
  try {
    const doc = await finaliseDocument({
      clinicId: session.clinicId,
      documentId,
      actorStaffUserId: session.staffUserId,
    });
    revalidatePath(`/console/documents/${documentId}`);
    return { ok: true, message: `Finalised as ${doc.documentNo}.` };
  } catch (error) {
    if (error instanceof DocumentError) return { ok: false, error: error.message };
    console.error("[documents] finalise failed", error);
    return { ok: false, error: "Couldn't finalise this document." };
  }
}

export async function issueCorrection(documentId: string): Promise<ActionResult & { id?: string }> {
  const session = await requireStaff();
  try {
    const correction = await correctDocument({
      clinicId: session.clinicId,
      documentId,
      actorStaffUserId: session.staffUserId,
    });
    return { ok: true, id: correction.id };
  } catch (error) {
    if (error instanceof DocumentError) return { ok: false, error: error.message };
    return { ok: false, error: "Couldn't start a correction." };
  }
}

export async function share(documentId: string): Promise<ActionResult & { url?: string }> {
  const session = await requireStaff();
  try {
    const { token } = await createShareLink({
      clinicId: session.clinicId,
      documentId,
      actorStaffUserId: session.staffUserId,
    });
    const base = process.env.APP_BASE_URL ?? "";
    return { ok: true, url: `${base}/d/${token}` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't create a link." };
  }
}

/**
 * Drafts the narrative from the episode's visit notes. The result is written
 * into the draft for the practitioner to correct — it is never finalised, never
 * signed and never sent by this action.
 */
export async function generateDraft(documentId: string): Promise<ActionResult & { data?: DocumentData }> {
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);

  const doc = await db.clinicalDocument.findFirst({
    where: { id: documentId },
    select: { id: true, episodeId: true, status: true, data: true },
  });
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.status !== "DRAFT") return { ok: false, error: "This document is already finalised." };
  if (!doc.episodeId) {
    return { ok: false, error: "Link this document to an episode of care first." };
  }

  try {
    const draft = await draftDischargeSummary({
      clinicId: session.clinicId,
      episodeId: doc.episodeId,
      actorStaffUserId: session.staffUserId,
    });

    // Never overwrite what the practitioner has already typed.
    const existing = (doc.data ?? {}) as DocumentData;
    const merged: DocumentData = { ...existing };
    for (const [key, value] of Object.entries(draft)) {
      const current = merged[key];
      const isBlank =
        current === undefined ||
        (Array.isArray(current) ? current.length === 0 : String(current).trim() === "");
      if (isBlank) merged[key] = value as string | string[];
    }

    await updateDocumentData({
      clinicId: session.clinicId,
      documentId,
      data: merged,
      actorStaffUserId: session.staffUserId,
    });

    return { ok: true, data: merged, message: "Draft written in. Please review every line." };
  } catch (error) {
    if (error instanceof AiDraftUnavailable) return { ok: false, error: error.message };
    console.error("[documents] draft failed", error);
    return { ok: false, error: "Couldn't generate a draft." };
  }
}
