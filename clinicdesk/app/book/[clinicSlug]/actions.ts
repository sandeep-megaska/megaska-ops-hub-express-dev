"use server";

import { headers } from "next/headers";
import { resolveClinicBySlug } from "@/lib/tenant";
import { createBooking, BookingError } from "@/services/scheduling/booking";
import { CONSENT_TEXT, CONSENT_VERSION } from "@/lib/consent";

export type BookingResult =
  | { ok: true; reference: string; startAtIso: string; practitionerName: string; serviceName: string }
  | { ok: false; error: string };

/**
 * Booking submission.
 *
 * Runs on the server and re-validates everything the client sent — the booking
 * widget is embedded on third-party websites, so nothing arriving here is
 * trustworthy, including the clinic slug.
 */
export async function submitBooking(formData: FormData): Promise<BookingResult> {
  const clinicSlug = String(formData.get("clinicSlug") ?? "");
  const clinic = await resolveClinicBySlug(clinicSlug);
  if (!clinic || clinic.status !== "ACTIVE") {
    return { ok: false, error: "This clinic is not taking online bookings right now." };
  }

  const startAtRaw = String(formData.get("startAt") ?? "");
  const startAt = new Date(startAtRaw);
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, error: "Please choose an appointment time." };
  }

  const fullName = String(formData.get("fullName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (fullName.length < 2) return { ok: false, error: "Please enter the patient's full name." };
  if (!phone) return { ok: false, error: "Please enter a phone number." };

  if (String(formData.get("consent") ?? "") !== "on") {
    return { ok: false, error: "Please accept the consent statement to continue." };
  }

  const headerList = await headers();

  try {
    const appointment = await createBooking({
      clinicId: clinic.id,
      serviceId: String(formData.get("serviceId") ?? ""),
      practitionerId: String(formData.get("practitionerId") ?? ""),
      startAt,
      fullName,
      phone,
      email: String(formData.get("email") ?? "").trim() || null,
      reasonForVisit: String(formData.get("reasonForVisit") ?? "").trim() || null,
      patientNotes: String(formData.get("patientNotes") ?? "").trim() || null,
      bookedTimezone: String(formData.get("timezone") ?? "").trim() || null,
      source: formData.get("embedded") === "1" ? "EMBED_WIDGET" : "BOOKING_PAGE",
      consent: { version: CONSENT_VERSION, textShown: CONSENT_TEXT },
      ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: headerList.get("user-agent"),
    });

    return {
      ok: true,
      reference: appointment.patient.patientNo,
      startAtIso: appointment.startAt.toISOString(),
      practitionerName: appointment.practitioner.fullName,
      serviceName: appointment.service.name,
    };
  } catch (error) {
    if (error instanceof BookingError) return { ok: false, error: error.message };
    console.error("[booking] failed", error);
    return { ok: false, error: "Something went wrong. Please call the clinic to book." };
  }
}
