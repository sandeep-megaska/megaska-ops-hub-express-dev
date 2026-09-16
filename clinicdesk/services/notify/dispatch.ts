import { prisma } from "@/lib/db";

export type OutboundMessage = {
  channel: "WHATSAPP" | "EMAIL" | "SMS";
  to: string;
  template: string;
  body: string;
  subject?: string;
};

/**
 * Sends one queued message.
 *
 * WhatsApp is the channel that matters in India — email reminders are
 * decorative. Providers are per-tenant (the pattern proven in megaska-ops-hub's
 * MerchantTwilioSettings / MerchantMsg91Settings), so the concrete client is
 * resolved from ClinicSettings rather than a global env var.
 *
 * With no provider configured the message is logged and marked SENT, so the
 * whole booking flow is demoable without a Meta Business account.
 */
export async function deliver(notificationId: string): Promise<void> {
  const notification = await prisma.notificationLog.findUnique({
    where: { id: notificationId },
    include: { clinic: { include: { settings: true } } },
  });
  if (!notification || notification.status !== "QUEUED") return;

  const payload = (notification.payload ?? {}) as { body?: string; subject?: string };
  const settings = notification.clinic.settings;

  try {
    if (notification.channel === "WHATSAPP" && !settings?.whatsappProvider) {
      console.info("[notify:whatsapp:dry-run]", {
        to: notification.toAddress,
        template: notification.template,
        body: payload.body,
      });
    } else if (notification.channel === "EMAIL" && !process.env.RESEND_API_KEY) {
      console.info("[notify:email:dry-run]", {
        to: notification.toAddress,
        subject: payload.subject,
        body: payload.body,
      });
    } else if (notification.channel === "EMAIL") {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: `${notification.clinic.name} <no-reply@${process.env.NEXT_PUBLIC_ROOT_DOMAIN?.split(":")[0] ?? "clinicdesk.in"}>`,
        to: notification.toAddress,
        subject: payload.subject ?? notification.clinic.name,
        text: payload.body ?? "",
      });
    } else {
      // A configured WhatsApp provider lands here. Kept as an explicit gap so
      // nobody assumes messages are going out in production by accident.
      throw new Error(
        `WhatsApp provider "${settings?.whatsappProvider}" is configured but no client is wired up yet.`,
      );
    }

    await prisma.notificationLog.update({
      where: { id: notification.id },
      data: { status: "SENT", sentAt: new Date() },
    });
  } catch (error) {
    await prisma.notificationLog.update({
      where: { id: notification.id },
      data: { status: "FAILED", error: error instanceof Error ? error.message : String(error) },
    });
  }
}

/** Drains the due queue. Call from a cron route. */
export async function drainQueue(limit = 50) {
  const due = await prisma.notificationLog.findMany({
    where: { status: "QUEUED", sendAfter: { lte: new Date() } },
    orderBy: { sendAfter: "asc" },
    take: limit,
    select: { id: true },
  });
  for (const row of due) await deliver(row.id);
  return due.length;
}
