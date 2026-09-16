import { clinicScope } from "../../lib/db.ts";
import { formatDateTimeIn, zoneAbbreviation } from "../scheduling/timezone.ts";

/**
 * Queues the confirmation and the reminder ladder for an appointment.
 *
 * Reminders render in the *patient's* timezone when it differs from the
 * clinic's, with the clinic's time alongside. A 6:30pm IST reminder that
 * reaches a patient in London at 2pm local without saying so is how people
 * miss teleconsults.
 */
export async function queueAppointmentMessages(clinicId: string, appointmentId: string) {
  const db = clinicScope(clinicId);

  const appointment = await db.appointment.findFirst({
    where: { id: appointmentId },
    include: {
      patient: true,
      service: true,
      practitioner: true,
      clinic: { include: { settings: true } },
    },
  });
  if (!appointment) return;

  const { clinic, patient, service, practitioner } = appointment;
  const clinicTz = clinic.timezone;
  const patientTz = patient.timezone ?? appointment.bookedTimezone ?? clinicTz;

  const clinicTime = `${formatDateTimeIn(appointment.startAt, clinicTz, clinic.locale)} ${zoneAbbreviation(appointment.startAt, clinicTz, clinic.locale)}`;
  const patientTime =
    patientTz === clinicTz
      ? null
      : `${formatDateTimeIn(appointment.startAt, patientTz, clinic.locale)} ${zoneAbbreviation(appointment.startAt, patientTz, clinic.locale)}`;

  const whenLine = patientTime ? `${clinicTime}\n(${patientTime} your time)` : clinicTime;

  const confirmBody = [
    `Hello ${patient.fullName.split(" ")[0]},`,
    ``,
    `Your appointment at ${clinic.name} is confirmed.`,
    ``,
    `${service.name} with ${practitioner.fullName}`,
    whenLine,
    clinic.addressLines.length ? `\n${clinic.addressLines.join(", ")}` : "",
    clinic.publicPhone ? `\nTo reschedule, call ${clinic.publicPhone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const channel = patient.phoneE164 ? "WHATSAPP" : "EMAIL";
  const to = patient.phoneE164 ?? patient.email;
  if (!to) return;

  await db.notificationLog.create({
    data: {
      clinicId,
      channel,
      template: "appointment.confirmed",
      toAddress: to,
      appointmentId: appointment.id,
      payload: { body: confirmBody, subject: `Appointment confirmed — ${clinic.name}` },
    },
  });

  const offsets = clinic.settings?.reminderOffsetsHours ?? [24, 2];
  for (const hours of offsets) {
    const sendAfter = new Date(appointment.startAt.getTime() - hours * 3600_000);
    if (sendAfter.getTime() <= Date.now()) continue;

    const reminderBody = [
      `Reminder: ${service.name} with ${practitioner.fullName} at ${clinic.name}.`,
      ``,
      whenLine,
      clinic.publicPhone ? `\nNeed to reschedule? Call ${clinic.publicPhone}.` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await db.notificationLog.create({
      data: {
        clinicId,
        channel,
        template: `appointment.reminder.${hours}h`,
        toAddress: to,
        appointmentId: appointment.id,
        sendAfter,
        payload: { body: reminderBody, subject: `Reminder — ${clinic.name}` },
      },
    });
  }
}

/** Cancels pending reminders when an appointment is cancelled or rescheduled. */
export async function cancelQueuedMessages(clinicId: string, appointmentId: string) {
  const db = clinicScope(clinicId);
  await db.notificationLog.updateMany({
    where: { appointmentId, status: "QUEUED" },
    data: { status: "SKIPPED" },
  });
}
