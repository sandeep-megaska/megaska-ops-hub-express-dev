import { prisma } from "@/lib/db";
import { fiscalYear } from "@/lib/ids";
import type { DocumentType } from "@/generated/prisma";

const PREFIX: Record<DocumentType, string> = {
  DISCHARGE_SUMMARY: "DS",
  PROGRESS_REPORT: "PR",
  FITNESS_CERTIFICATE: "FC",
  REFERRAL_LETTER: "RL",
  HOME_EXERCISE_PROGRAMME: "HEP",
  RECEIPT: "R",
};

/**
 * Allocates the next document number for a clinic/type/financial year.
 *
 * Done as a single atomic upsert-and-increment rather than read-then-write:
 * two practitioners finalising at the same moment must never share a number,
 * and a clinical document number is quoted back by patients and insurers.
 *
 * Numbers reset each Indian financial year (1 April), which is what her CA
 * expects when reconciling.
 */
export async function allocateDocumentNumber(
  clinicId: string,
  type: DocumentType,
  timezone = "Asia/Kolkata",
  at = new Date(),
): Promise<string> {
  const fy = fiscalYear(at, timezone);

  const [row] = await prisma.$queryRaw<Array<{ lastValue: number }>>`
    INSERT INTO "DocumentCounter" ("id", "clinicId", "type", "fiscalYear", "lastValue")
    VALUES (gen_random_uuid(), ${clinicId}, ${type}::"DocumentType", ${fy}, 1)
    ON CONFLICT ("clinicId", "type", "fiscalYear")
    DO UPDATE SET "lastValue" = "DocumentCounter"."lastValue" + 1
    RETURNING "lastValue"
  `;

  return `${PREFIX[type]}/${fy}/${String(row.lastValue).padStart(4, "0")}`;
}

/** Bills share the mechanism but live on their own sequence. */
export async function allocateBillNumber(
  clinicId: string,
  timezone = "Asia/Kolkata",
  at = new Date(),
): Promise<string> {
  return allocateDocumentNumber(clinicId, "RECEIPT", timezone, at);
}
