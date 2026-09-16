import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, clinicScope, TenantScopeError } from "./db.ts";

/**
 * Tenant isolation is the invariant this whole product rests on. A missing
 * clinic filter on patient data is a reportable breach, not a bug, so it gets a
 * test that runs against a real database rather than a mock.
 */

async function makeClinic(slug: string) {
  return prisma.clinic.upsert({
    where: { slug },
    update: {},
    create: { slug, name: `Test ${slug}`, status: "ACTIVE" },
  });
}

test("a scoped client cannot read another clinic's patients", async () => {
  const [alpha, beta] = await Promise.all([
    makeClinic("test-alpha"),
    makeClinic("test-beta"),
  ]);

  const alphaDb = clinicScope(alpha.id);
  const betaDb = clinicScope(beta.id);

  await alphaDb.patient.upsert({
    where: { clinicId_patientNo: { clinicId: alpha.id, patientNo: "A-1" } },
    update: {},
    create: { clinicId: alpha.id, patientNo: "A-1", fullName: "Alpha Patient" },
  });
  await betaDb.patient.upsert({
    where: { clinicId_patientNo: { clinicId: beta.id, patientNo: "B-1" } },
    update: {},
    create: { clinicId: beta.id, patientNo: "B-1", fullName: "Beta Patient" },
  });

  // An unfiltered findMany — the exact mistake the scope exists to catch.
  const seenByAlpha = await alphaDb.patient.findMany();
  assert.ok(seenByAlpha.length > 0, "alpha should see its own patients");
  assert.ok(
    seenByAlpha.every((patient) => patient.clinicId === alpha.id),
    "alpha must never see another clinic's patients",
  );
  assert.ok(!seenByAlpha.some((p) => p.fullName === "Beta Patient"));
});

test("fetching another clinic's row by id returns nothing", async () => {
  const [alpha, beta] = await Promise.all([makeClinic("test-alpha"), makeClinic("test-beta")]);
  const betaPatient = await clinicScope(beta.id).patient.findFirst({
    where: { patientNo: "B-1" },
  });
  assert.ok(betaPatient, "beta patient should exist");

  // Alpha guesses beta's UUID.
  const stolen = await clinicScope(alpha.id).patient.findFirst({
    where: { id: betaPatient.id },
  });
  assert.equal(stolen, null, "a cross-tenant id lookup must return null");
});

test("findUnique on a tenant model is refused rather than silently unscoped", async () => {
  const alpha = await makeClinic("test-alpha");
  await assert.rejects(
    () => clinicScope(alpha.id).patient.findUnique({ where: { id: "whatever" } }),
    TenantScopeError,
    "findUnique bypasses the injected filter and must be rejected",
  );
});

test("writing a row stamped with a different clinicId is refused", async () => {
  const [alpha, beta] = await Promise.all([makeClinic("test-alpha"), makeClinic("test-beta")]);
  await assert.rejects(
    () =>
      clinicScope(alpha.id).patient.create({
        data: { clinicId: beta.id, patientNo: "X-1", fullName: "Smuggled" },
      }),
    TenantScopeError,
    "a create carrying another clinic's id must be rejected",
  );
});

test("updates cannot reach across tenants", async () => {
  const [alpha, beta] = await Promise.all([makeClinic("test-alpha"), makeClinic("test-beta")]);
  const betaPatient = await clinicScope(beta.id).patient.findFirst({ where: { patientNo: "B-1" } });

  const result = await clinicScope(alpha.id).patient.updateMany({
    where: { id: betaPatient!.id },
    data: { fullName: "Tampered" },
  });
  assert.equal(result.count, 0, "alpha must not be able to update beta's record");

  const after = await clinicScope(beta.id).patient.findFirst({ where: { patientNo: "B-1" } });
  assert.equal(after!.fullName, "Beta Patient");
});

test("non-tenant models are left alone", async () => {
  const alpha = await makeClinic("test-alpha");
  // Clinic itself carries no clinicId, so findUnique stays available.
  const found = await clinicScope(alpha.id).clinic.findUnique({ where: { slug: "test-alpha" } });
  assert.equal(found?.id, alpha.id);
});

test.after(async () => {
  await prisma.clinic.deleteMany({ where: { slug: { in: ["test-alpha", "test-beta"] } } });
  await prisma.$disconnect();
});
