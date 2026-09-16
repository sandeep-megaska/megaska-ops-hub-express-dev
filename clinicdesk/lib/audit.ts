import { prisma } from "./db.ts";
import type { Prisma } from "@/generated/prisma";

export type AuditInput = {
  clinicId: string;
  action:
    | "VIEW"
    | "CREATE"
    | "UPDATE"
    | "DELETE"
    | "FINALISE"
    | "SHARE"
    | "LOGIN"
    | "LOGOUT"
    | "EXPORT";
  resourceType: string;
  resourceId?: string | null;
  patientId?: string | null;
  actorStaffUserId?: string | null;
  actorLabel?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Audit writes go through the unscoped client deliberately: the audit trail
 * must be writable even from paths that failed tenant scoping, and it must
 * never be filtered out by the very bug it exists to catch.
 *
 * Reads are audited as well as writes — after an incident the question asked is
 * "who looked at this chart", and a write-only log cannot answer it.
 *
 * Auditing must never break the request it describes, so failures are logged
 * and swallowed.
 */
export async function recordAudit(input: AuditInput) {
  try {
    await prisma.auditEvent.create({
      data: {
        clinicId: input.clinicId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        patientId: input.patientId ?? null,
        actorStaffUserId: input.actorStaffUserId ?? null,
        actorLabel: input.actorLabel ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonObject | undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] failed to record event", { input, error });
  }
}
