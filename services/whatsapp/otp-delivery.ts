// WhatsApp OTP delivery outcome. Meta accepts an OTP send synchronously but
// reports delivery (or the reason it dropped the message) later through the
// webhook. Those statuses are saved on the matching OTPChallenge
// (providerSid = wamid) under metadata.delivery, so a code that never arrived
// can be explained from the database instead of searching logs.

import type { WebhookValue } from "./inbox.ts";

type OtpDeliveryDb = {
  oTPChallenge: {
    findFirst(args: Record<string, unknown>): Promise<{ id: string; metadata: unknown } | null>;
    update(args: Record<string, unknown>): Promise<unknown>;
  };
};

const RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

export function describeStatusErrors(errors: Array<{ code?: number; title?: string; message?: string }> | undefined) {
  return (errors || []).map((e) => `${e.code ?? ""} ${e.title || e.message || ""}`.trim()).filter(Boolean).join("; ").slice(0, 500) || null;
}

async function defaultDb(): Promise<OtpDeliveryDb> {
  const { prisma } = await import("../db/prisma.ts");
  return prisma as unknown as OtpDeliveryDb;
}

export async function recordOtpDeliveryStatuses(value: WebhookValue, deps: { db?: OtpDeliveryDb; now?: Date } = {}) {
  const statuses = (value.statuses || []).filter((s) => s.id && s.status && RANK[s.status]);
  if (!statuses.length) return 0;
  const db = deps.db ?? (await defaultDb());
  let updated = 0;
  for (const status of statuses) {
    const challenge = await db.oTPChallenge.findFirst({ where: { provider: "whatsapp", providerSid: status.id }, select: { id: true, metadata: true } });
    if (!challenge) continue;
    const metadata = (challenge.metadata && typeof challenge.metadata === "object" ? challenge.metadata : {}) as Record<string, unknown>;
    const previous = (metadata.delivery as { status?: string } | undefined)?.status;
    if (previous && (RANK[previous] || 0) >= RANK[status.status as string]) continue;
    const error = status.status === "failed" ? describeStatusErrors(status.errors) || "failed" : null;
    const delivery = { status: status.status, error, at: (deps.now ?? new Date()).toISOString() };
    await db.oTPChallenge.update({ where: { id: challenge.id }, data: { metadata: { ...metadata, delivery } } });
    if (error) console.warn("[OTP WHATSAPP DELIVERY FAILED]", { challengeId: challenge.id, error });
    updated += 1;
  }
  return updated;
}
