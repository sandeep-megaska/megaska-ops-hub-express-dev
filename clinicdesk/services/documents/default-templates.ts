import type { TemplateField } from "./template";
import type { DocumentType } from "@/generated/prisma";
import { SEED_TEMPLATES as RAW } from "./default-templates.data.mjs";

/**
 * Starter templates every new clinic gets at onboarding. They are seeded as
 * ordinary rows, so a clinic can edit them without a deploy — and a new
 * document type for a new tenant is a row, not a code change.
 *
 * The discharge summary follows the structure Indian physiotherapy practice
 * actually uses. Replace it with the pilot's own once she sends three real
 * (redacted) summaries — reverse-engineering her fields beats inventing ours.
 *
 * The data lives in `default-templates.data.mjs` so `prisma/seed.mjs` can
 * import the same definitions at runtime without a build step.
 */
export type SeedTemplate = {
  type: DocumentType;
  name: string;
  fields: TemplateField[];
  bodyHtml: string;
};

export const SEED_TEMPLATES = RAW as unknown as SeedTemplate[];
