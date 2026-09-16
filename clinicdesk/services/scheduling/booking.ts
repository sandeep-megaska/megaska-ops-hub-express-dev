import { parsePhoneNumberFromString } from "libphonenumber-js";
import { clinicScope } from "../../lib/db.ts";
import { recordAudit } from "../../lib/audit.ts";
import { queueAppointmentMessages } from "../notify/appointment-messages.ts";

export type BookingInput = {
  clinicId: string;
  serviceId: string;
  practitionerId: string;
  startAt: Date;
  fullName: string;
  phone: string;
  /** Country the phone number should be parsed against when not in E.164. */
  defaultCountry?: "IN";
  email?: string | null;
  reasonForVisit?: string | null;
  patientNotes?: string | null;
  bookedTimezone?: string | null;
  source?: "EMBED_WIDGET" | "BOOKING_PAGE" | "FRONT_DESK" | "PHONE";
  consent?: { version: string; textShown: string } | null;
  ip?: string | null;
  userAgent?: string | null;
};

export class BookingError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BookingError";
  }
}

function normalisePhone(raw: string, defaultCountry: "IN" = "IN") {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  if (!parsed?.isValid()) {
    throw new BookingError("INVALID_PHONE", "That phone number doesn't look right.");
  }
  return parsed.number;
}

type PatientCounter = { patient: { count: (args: { where: object }) => Promise<number> } };

/** "HP-0042" — sequential per clinic, derived from the clinic's initials. */
async function nextPatientNo(db: PatientCounter, clinicName: string) {
  const prefix =
    clinicName
      .split(/\s+/)
      .map((w) => w[0])
      .filter((c) => /[A-Za-z]/.test(c ?? ""))
      .join("")
      .slice(0, 3)
      .toUpperCase() || "P";
  const count = await db.patient.count({ where: {} });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

/**
 * Books an appointment, creating or matching the patient by phone.
 *
 * The slot is re-checked inside the write path: availability shown to the
 * patient is a snapshot, and two people tapping the same 6pm slot is the normal
 * case, not the edge case.
 */
export async function createBooking(input: BookingInput) {
  const db = clinicScope(input.clinicId);
  const phoneE164 = normalisePhone(input.phone, input.defaultCountry ?? "IN");

  const [service, practitioner] = await Promise.all([
    db.service.findFirst({ where: { id: input.serviceId, isActive: true } }),
    db.practitioner.findFirst({ where: { id: input.practitionerId, isBookable: true } }),
  ]);
  if (!service) throw new BookingError("UNKNOWN_SERVICE", "That service is no longer offered.");
  if (!practitioner) throw new BookingError("UNKNOWN_PRACTITIONER", "That practitioner is unavailable.");

  const startAt = input.startAt;
  const endAt = new Date(startAt.getTime() + service.durationMins * 60_000);
  const blockEnd = new Date(endAt.getTime() + service.bufferMins * 60_000);

  if (startAt.getTime() <= Date.now()) {
    throw new BookingError("IN_THE_PAST", "That time has already passed.");
  }

  const appointment = await db.$transaction(async (tx) => {
    // Compare buffered block against buffered block. Testing the new booking's
    // block against the existing appointment's bare `endAt` ignores the
    // turnaround the previous patient's session still needs.
    const clash = await tx.appointment.findFirst({
      where: {
        practitionerId: practitioner.id,
        status: { in: ["REQUESTED", "CONFIRMED", "ARRIVED"] },
        startAt: { lt: blockEnd },
        blockEndAt: { gt: startAt },
      },
      select: { id: true },
    });
    if (clash) {
      throw new BookingError("SLOT_TAKEN", "Sorry — that slot was just taken. Please pick another.");
    }

    let patient = await tx.patient.findFirst({ where: { phoneE164 } });
    if (!patient) {
      const clinicRow = await tx.clinic.findUnique({
        where: { id: input.clinicId },
        select: { name: true },
      });
      patient = await tx.patient.create({
        data: {
          clinicId: input.clinicId,
          patientNo: await nextPatientNo(tx, clinicRow?.name ?? "Clinic"),
          fullName: input.fullName.trim(),
          phoneE164,
          email: input.email?.trim() || null,
          timezone: input.bookedTimezone ?? null,
        },
      });
    } else if (input.email && !patient.email) {
      patient = await tx.patient.update({
        where: { id: patient.id },
        data: { email: input.email.trim() },
      });
    }

    if (input.consent) {
      await tx.consent.create({
        data: {
          clinicId: input.clinicId,
          patientId: patient.id,
          type: "DATA_PROCESSING",
          version: input.consent.version,
          textShown: input.consent.textShown,
          granted: true,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
        },
      });
    }

    return tx.appointment.create({
      data: {
        clinicId: input.clinicId,
        patientId: patient.id,
        practitionerId: practitioner.id,
        serviceId: service.id,
        startAt,
        endAt,
        blockEndAt: blockEnd,
        bookedTimezone: input.bookedTimezone ?? null,
        status: "CONFIRMED",
        confirmedAt: new Date(),
        source: input.source ?? "BOOKING_PAGE",
        reasonForVisit: input.reasonForVisit?.trim() || null,
        patientNotes: input.patientNotes?.trim() || null,
      },
      include: { patient: true, service: true, practitioner: true },
    });
  });

  await queueAppointmentMessages(input.clinicId, appointment.id);
  await recordAudit({
    clinicId: input.clinicId,
    action: "CREATE",
    resourceType: "Appointment",
    resourceId: appointment.id,
    patientId: appointment.patientId,
    actorLabel: `patient:${appointment.patient.fullName}`,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return appointment;
}
