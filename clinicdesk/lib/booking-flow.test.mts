import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, clinicScope } from "./db.ts";
import { createBooking, BookingError } from "../services/scheduling/booking.ts";

/**
 * Double-booking is the failure the clinic notices immediately: two patients
 * turn up for the same slot. Availability shown to a patient is a snapshot, so
 * the write path has to re-check, and that re-check needs a real test.
 */

const SLUG = "test-booking";

async function fixture() {
  const clinic = await prisma.clinic.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      name: "Booking Test Clinic",
      status: "ACTIVE",
      timezone: "Asia/Kolkata",
      settings: { create: {} },
    },
  });
  const db = clinicScope(clinic.id);

  const practitioner =
    (await db.practitioner.findFirst({ where: {} })) ??
    (await db.practitioner.create({
      data: { clinicId: clinic.id, fullName: "Test Practitioner", isBookable: true },
    }));

  const service =
    (await db.service.findFirst({ where: {} })) ??
    (await db.service.create({
      data: {
        clinicId: clinic.id,
        name: "Test Session",
        durationMins: 30,
        bufferMins: 15,
        priceMinor: 50000,
        practitioners: { connect: { id: practitioner.id } },
      },
    }));

  return { clinic, practitioner, service };
}

function soon(minutes: number) {
  return new Date(Date.now() + minutes * 60_000);
}

test("a booking creates the patient and the appointment", async () => {
  const { clinic, practitioner, service } = await fixture();
  const appointment = await createBooking({
    clinicId: clinic.id,
    serviceId: service.id,
    practitionerId: practitioner.id,
    startAt: soon(60 * 24),
    fullName: "Test Patient One",
    phone: "9847011111",
    bookedTimezone: "Asia/Kolkata",
    consent: { version: "test", textShown: "test consent" },
  });

  assert.equal(appointment.status, "CONFIRMED");
  assert.equal(appointment.patient.phoneE164, "+919847011111", "Indian numbers normalise to E.164");
  assert.equal(
    appointment.endAt.getTime() - appointment.startAt.getTime(),
    30 * 60_000,
    "the appointment lasts the service duration, not the buffered block",
  );

  const consent = await clinicScope(clinic.id).consent.findFirst({
    where: { patientId: appointment.patientId },
  });
  assert.ok(consent, "consent must be recorded at booking");
  assert.equal(consent.textShown, "test consent", "the exact wording shown is snapshotted");
});

test("the same slot cannot be booked twice", async () => {
  const { clinic, practitioner, service } = await fixture();
  const startAt = soon(60 * 26);

  await createBooking({
    clinicId: clinic.id,
    serviceId: service.id,
    practitionerId: practitioner.id,
    startAt,
    fullName: "First Patient",
    phone: "9847022222",
  });

  await assert.rejects(
    () =>
      createBooking({
        clinicId: clinic.id,
        serviceId: service.id,
        practitionerId: practitioner.id,
        startAt,
        fullName: "Second Patient",
        phone: "9847033333",
      }),
    (error: unknown) => error instanceof BookingError && error.code === "SLOT_TAKEN",
  );
});

test("the buffer blocks a booking that starts before the previous one has cleared", async () => {
  const { clinic, practitioner, service } = await fixture();
  const startAt = soon(60 * 28);

  await createBooking({
    clinicId: clinic.id,
    serviceId: service.id,
    practitionerId: practitioner.id,
    startAt,
    fullName: "Buffer First",
    phone: "9847044444",
  });

  // 30-minute session + 15-minute buffer, so +40 minutes still collides.
  await assert.rejects(
    () =>
      createBooking({
        clinicId: clinic.id,
        serviceId: service.id,
        practitionerId: practitioner.id,
        startAt: new Date(startAt.getTime() + 40 * 60_000),
        fullName: "Buffer Second",
        phone: "9847055555",
      }),
    (error: unknown) => error instanceof BookingError && error.code === "SLOT_TAKEN",
  );
});

test("a returning patient is matched by phone, not duplicated", async () => {
  const { clinic, practitioner, service } = await fixture();
  const phone = "+919847066666";

  const first = await createBooking({
    clinicId: clinic.id, serviceId: service.id, practitionerId: practitioner.id,
    startAt: soon(60 * 30), fullName: "Repeat Patient", phone,
  });
  const second = await createBooking({
    clinicId: clinic.id, serviceId: service.id, practitionerId: practitioner.id,
    startAt: soon(60 * 32), fullName: "Repeat Patient", phone,
  });

  assert.equal(first.patientId, second.patientId, "one person must not become two records");
});

test("an unparseable phone number is rejected", async () => {
  const { clinic, practitioner, service } = await fixture();
  await assert.rejects(
    () =>
      createBooking({
        clinicId: clinic.id, serviceId: service.id, practitionerId: practitioner.id,
        startAt: soon(60 * 34), fullName: "Bad Phone", phone: "12",
      }),
    (error: unknown) => error instanceof BookingError && error.code === "INVALID_PHONE",
  );
});

test("a slot in the past is rejected", async () => {
  const { clinic, practitioner, service } = await fixture();
  await assert.rejects(
    () =>
      createBooking({
        clinicId: clinic.id, serviceId: service.id, practitionerId: practitioner.id,
        startAt: soon(-60), fullName: "Time Traveller", phone: "9847077777",
      }),
    (error: unknown) => error instanceof BookingError && error.code === "IN_THE_PAST",
  );
});

test("reminders are queued in the patient's own timezone", async () => {
  const { clinic, practitioner, service } = await fixture();
  const appointment = await createBooking({
    clinicId: clinic.id, serviceId: service.id, practitionerId: practitioner.id,
    startAt: soon(60 * 36), fullName: "Abroad Patient", phone: "+447911123456",
    bookedTimezone: "Europe/London",
  });

  const queued = await clinicScope(clinic.id).notificationLog.findMany({
    where: { appointmentId: appointment.id },
    orderBy: { sendAfter: "asc" },
  });

  assert.ok(queued.length >= 2, "a confirmation plus at least one reminder");
  assert.ok(queued.some((row) => row.template === "appointment.confirmed"));
  const reminder = queued.find((row) => row.template.startsWith("appointment.reminder"));
  assert.ok(reminder, "a reminder should be queued");
  const body = String((reminder.payload as { body?: string })?.body ?? "");
  assert.ok(body.includes("your time"), "a patient abroad must be told their local time");
});

test.after(async () => {
  await prisma.clinic.deleteMany({ where: { slug: SLUG } });
  await prisma.$disconnect();
});
