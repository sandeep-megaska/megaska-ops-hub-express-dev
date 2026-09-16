import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";
import { SEED_TEMPLATES } from "../services/documents/default-templates.data.mjs";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const SLUG = process.env.SEED_CLINIC_SLUG ?? "heal";

/** Local wall-clock helper — the seed writes IST times, stored as UTC. */
function ist(dateKey, hour, minute = 0) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - 5, minute - 30));
}

function dayKey(offsetDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Seeding clinic "${SLUG}"…`);

  const clinic = await prisma.clinic.upsert({
    where: { slug: SLUG },
    update: {},
    create: {
      slug: SLUG,
      name: "Heal Physiotherapy",
      status: "ACTIVE",
      timezone: "Asia/Kolkata",
      locale: "en-IN",
      currency: "INR",
      publicEmail: "care@healphysiotherapy.in",
      publicPhone: "+91 98470 00000",
      websiteUrl: "https://www.healphysiotherapy.in",
      addressLines: ["2nd Floor, MG Road", "Kochi, Kerala 682016"],
      primaryColor: "#0f766e",
      onboardedAt: new Date(),
      settings: {
        create: {
          slotGranularityMins: 15,
          minNoticeMins: 120,
          maxAdvanceDays: 45,
          reminderOffsetsHours: [24, 2],
          // Empty means "any origin" — fine for the pilot, tighten before
          // onboarding a second clinic.
          embedAllowedOrigins: [],
        },
      },
    },
  });

  await prisma.clinicDomain.upsert({
    where: { hostname: "book.healphysiotherapy.in" },
    update: {},
    create: {
      clinicId: clinic.id,
      hostname: "book.healphysiotherapy.in",
      isPrimary: true,
      // Left unverified on purpose: an unverified domain must not resolve to a
      // tenant. Verify it once the CNAME is actually pointed.
      verifiedAt: null,
    },
  });

  const letterhead = await prisma.letterhead.upsert({
    where: { id: `${clinic.id}-default` },
    update: {},
    create: {
      id: `${clinic.id}-default`,
      clinicId: clinic.id,
      name: "Default",
      mode: "DIGITAL",
      practiceName: "Heal Physiotherapy",
      practitionerLine: "Dr. Anjali Menon, MPT (Orthopaedics)",
      registrationNo: "KSCP/PT/12345",
      headerLines: [
        "2nd Floor, MG Road, Kochi, Kerala 682016",
        "+91 98470 00000 · care@healphysiotherapy.in · www.healphysiotherapy.in",
      ],
      footerLines: ["Heal Physiotherapy · Kochi", "This document is issued for medical record purposes."],
      signatureName: "Dr. Anjali Menon",
      signatureSubtitle: "MPT (Orthopaedics) · Reg. KSCP/PT/12345",
      wetSignature: true,
      marginTopMm: 20,
      marginBottomMm: 18,
    },
  });

  const owner = await prisma.staffUser.upsert({
    where: { clinicId_email: { clinicId: clinic.id, email: "anjali@healphysiotherapy.in" } },
    update: {},
    create: {
      clinicId: clinic.id,
      email: "anjali@healphysiotherapy.in",
      fullName: "Dr. Anjali Menon",
      role: "OWNER",
    },
  });

  const practitioner = await prisma.practitioner.upsert({
    where: { staffUserId: owner.id },
    update: {},
    create: {
      clinicId: clinic.id,
      staffUserId: owner.id,
      fullName: "Dr. Anjali Menon",
      qualifications: "MPT (Orthopaedics)",
      registrationNo: "KSCP/PT/12345",
      isBookable: true,
    },
  });

  const serviceSpecs = [
    { name: "Initial Assessment", durationMins: 45, priceMinor: 80000, order: 0,
      description: "Full assessment, diagnosis and treatment plan." },
    { name: "Follow-up Session", durationMins: 30, priceMinor: 60000, order: 1,
      description: "Ongoing treatment session." },
    { name: "Teleconsultation", durationMins: 30, priceMinor: 50000, order: 2,
      isTeleconsult: true, description: "Video consultation — available for patients abroad." },
    { name: "Home Visit", durationMins: 60, priceMinor: 150000, order: 3, bufferMins: 30,
      description: "Treatment at the patient's home within Kochi." },
  ];

  const services = [];
  for (const spec of serviceSpecs) {
    const existing = await prisma.service.findFirst({
      where: { clinicId: clinic.id, name: spec.name },
    });
    const service =
      existing ??
      (await prisma.service.create({
        data: {
          clinicId: clinic.id,
          name: spec.name,
          description: spec.description,
          durationMins: spec.durationMins,
          bufferMins: spec.bufferMins ?? 0,
          priceMinor: spec.priceMinor,
          isTeleconsult: spec.isTeleconsult ?? false,
          displayOrder: spec.order,
          practitioners: { connect: { id: practitioner.id } },
        },
      }));
    services.push(service);
  }

  // Mon–Sat, 9:00–13:00 and 16:00–19:30 clinic-local.
  const existingRules = await prisma.availabilityRule.count({ where: { clinicId: clinic.id } });
  if (existingRules === 0) {
    for (let weekday = 1; weekday <= 6; weekday += 1) {
      await prisma.availabilityRule.createMany({
        data: [
          { clinicId: clinic.id, practitionerId: practitioner.id, weekday, startMins: 9 * 60, endMins: 13 * 60 },
          { clinicId: clinic.id, practitionerId: practitioner.id, weekday, startMins: 16 * 60, endMins: 19 * 60 + 30 },
        ],
      });
    }
  }

  for (const template of SEED_TEMPLATES) {
    await prisma.documentTemplate.upsert({
      where: {
        clinicId_type_name_version: {
          clinicId: clinic.id,
          type: template.type,
          name: template.name,
          version: 1,
        },
      },
      update: { fields: template.fields, bodyHtml: template.bodyHtml },
      create: {
        clinicId: clinic.id,
        type: template.type,
        name: template.name,
        version: 1,
        fields: template.fields,
        bodyHtml: template.bodyHtml,
      },
    });
  }

  const patientSpecs = [
    {
      patientNo: "HP-0001",
      fullName: "Ramesh Kurian",
      phoneE164: "+919847012345",
      email: "ramesh.k@example.com",
      sex: "MALE",
      dateOfBirth: new Date(Date.UTC(1978, 4, 12)),
      city: "Kochi",
      allergies: "None known",
      medicalHistory: "Type 2 diabetes, controlled on metformin.",
      referredBy: "Dr. S. Pillai (Orthopaedics)",
    },
    {
      patientNo: "HP-0002",
      fullName: "Sandra Thomas",
      phoneE164: "+447911123456",
      email: "sandra.thomas@example.co.uk",
      sex: "FEMALE",
      dateOfBirth: new Date(Date.UTC(1990, 10, 3)),
      city: "London",
      country: "GB",
      timezone: "Europe/London",
      allergies: "Penicillin",
    },
    {
      patientNo: "HP-0003",
      fullName: "Fathima Beevi",
      phoneE164: "+919447098765",
      sex: "FEMALE",
      dateOfBirth: new Date(Date.UTC(1957, 1, 20)),
      city: "Aluva",
      medicalHistory: "Hypertension. Right total knee replacement, Jan 2026.",
    },
  ];

  const patients = [];
  for (const spec of patientSpecs) {
    const patient = await prisma.patient.upsert({
      where: { clinicId_patientNo: { clinicId: clinic.id, patientNo: spec.patientNo } },
      update: {},
      create: { clinicId: clinic.id, ...spec },
    });
    patients.push(patient);
  }

  // An episode with real visit notes, so the discharge summary has something to
  // summarise and the AI draft has something honest to work from.
  let episode = await prisma.episode.findFirst({
    where: { clinicId: clinic.id, patientId: patients[0].id },
  });
  if (!episode) {
    episode = await prisma.episode.create({
      data: {
        clinicId: clinic.id,
        patientId: patients[0].id,
        practitionerId: practitioner.id,
        title: "L4-L5 disc prolapse with right radiculopathy",
        presentingComplaint:
          "Low back pain radiating to the right leg for 6 weeks, worse on sitting and forward bending.",
        provisionalDiagnosis: "L4-L5 disc prolapse with right L5 radiculopathy",
        onsetDate: ist(dayKey(-60), 9),
        status: "ACTIVE",
        startedAt: ist(dayKey(-42), 10),
      },
    });

    const noteSpecs = [
      { day: -42, s: "Pain 8/10, radiating below the knee. Unable to sit beyond 15 minutes.",
        o: "SLR right 35°. Lumbar flexion restricted to 40°. Tenderness over L4-L5 paraspinals.",
        a: "Acute L5 radiculopathy secondary to disc prolapse.",
        p: "Commence IFT, gentle McKenzie extension protocol. Educate on sitting posture.",
        measures: [{ code: "NPRS", label: "Pain (NPRS 0-10)", value: "8" }, { code: "SLR", label: "SLR right", value: "35°" }],
        interventions: ["IFT", "McKenzie extension protocol", "Postural education"] },
      { day: -28, s: "Pain 5/10, no longer radiating past the calf. Sitting tolerance 40 minutes.",
        o: "SLR right 55°. Lumbar flexion 60°. Reduced paraspinal guarding.",
        a: "Good response to extension protocol. Centralisation achieved.",
        p: "Progress to core stabilisation. Continue IFT twice weekly.",
        measures: [{ code: "NPRS", label: "Pain (NPRS 0-10)", value: "5" }, { code: "SLR", label: "SLR right", value: "55°" }],
        interventions: ["IFT", "Core stabilisation", "McKenzie extension protocol"] },
      { day: -10, s: "Pain 2/10 on prolonged sitting only. Returned to desk work full time.",
        o: "SLR right 75°. Full lumbar range. Good core activation.",
        a: "Near-complete resolution. Ready for discharge planning.",
        p: "Home programme, review in 6 weeks if symptoms recur.",
        measures: [{ code: "NPRS", label: "Pain (NPRS 0-10)", value: "2" }, { code: "SLR", label: "SLR right", value: "75°" }],
        interventions: ["Core stabilisation", "Home exercise prescription"] },
    ];

    for (const note of noteSpecs) {
      await prisma.visitNote.create({
        data: {
          clinicId: clinic.id,
          patientId: patients[0].id,
          episodeId: episode.id,
          practitionerId: practitioner.id,
          visitDate: ist(dayKey(note.day), 10),
          subjective: note.s,
          objective: note.o,
          assessment: note.a,
          plan: note.p,
          measures: note.measures,
          interventions: note.interventions,
          status: "SIGNED",
          signedAt: ist(dayKey(note.day), 11),
        },
      });
    }
  }

  // Upcoming appointments so the Today view isn't empty.
  const upcoming = await prisma.appointment.count({
    where: { clinicId: clinic.id, startAt: { gte: new Date() } },
  });
  if (upcoming === 0) {
    const slots = [
      { patient: patients[0], service: services[1], day: 0, hour: 10, minute: 0 },
      { patient: patients[2], service: services[1], day: 0, hour: 11, minute: 30 },
      { patient: patients[1], service: services[2], day: 0, hour: 17, minute: 0, tz: "Europe/London" },
      { patient: patients[2], service: services[1], day: 1, hour: 9, minute: 30 },
    ];
    for (const slot of slots) {
      const startAt = ist(dayKey(slot.day), slot.hour, slot.minute);
      if (startAt.getTime() < Date.now()) continue;
      await prisma.appointment.create({
        data: {
          clinicId: clinic.id,
          patientId: slot.patient.id,
          practitionerId: practitioner.id,
          serviceId: slot.service.id,
          episodeId: slot.patient.id === patients[0].id ? episode.id : null,
          startAt,
          endAt: new Date(startAt.getTime() + slot.service.durationMins * 60_000),
          blockEndAt: new Date(
            startAt.getTime() + (slot.service.durationMins + slot.service.bufferMins) * 60_000,
          ),
          bookedTimezone: slot.tz ?? "Asia/Kolkata",
          status: "CONFIRMED",
          confirmedAt: new Date(),
          source: "BOOKING_PAGE",
          reasonForVisit: "Follow-up",
        },
      });
    }
  }

  // A session package and a paid receipt, so billing has something to show.
  const existingPackage = await prisma.sessionPackage.findFirst({
    where: { clinicId: clinic.id, patientId: patients[0].id },
  });
  if (!existingPackage) {
    await prisma.sessionPackage.create({
      data: {
        clinicId: clinic.id,
        patientId: patients[0].id,
        serviceId: services[1].id,
        name: "10-session physiotherapy package",
        sessionsTotal: 10,
        sessionsUsed: 7,
        priceMinor: 500000,
      },
    });
  }

  console.log(`✓ Clinic ${clinic.name} (${clinic.slug})`);
  console.log(`✓ Letterhead ${letterhead.name} · ${letterhead.mode}`);
  console.log(`✓ Sign in at /console/login as ${owner.email}`);
  console.log(`  (login code is printed to this server log in dev)`);
  console.log(`✓ Public booking at /book/${clinic.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
