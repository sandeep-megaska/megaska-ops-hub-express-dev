// Runtime data module. `default-templates.ts` re-exports this with types, and
// `prisma/seed.mjs` imports it directly — one source of truth, no duplication.

/**
 * Starter templates every new clinic gets at onboarding. They are seeded as
 * ordinary rows, so a clinic can edit them without a deploy — and a new
 * document type for a new tenant is a row, not a code change.
 *
 * The discharge summary follows the structure Indian physiotherapy practice
 * actually uses. Replace it with the pilot's own once she sends three real
 * (redacted) summaries — reverse-engineering her fields beats inventing ours.
 */

const DISCHARGE_FIELDS = [
  { key: "diagnosis", label: "Diagnosis", kind: "text", required: true },
  { key: "referred_by", label: "Referred by", kind: "text" },
  { key: "date_of_assessment", label: "Date of first assessment", kind: "date", group: "dates" },
  { key: "date_of_discharge", label: "Date of discharge", kind: "date", group: "dates" },
  { key: "sessions_attended", label: "Sessions attended", kind: "number", group: "dates" },
  {
    key: "presenting_complaint",
    label: "Presenting complaint",
    kind: "textarea",
    required: true,
    hint: "In the patient's own terms, plus onset and duration.",
  },
  { key: "assessment_findings", label: "Assessment findings", kind: "textarea", required: true },
  { key: "outcome_measures", label: "Outcome measures", kind: "measures" },
  {
    key: "treatment_provided",
    label: "Treatment provided",
    kind: "textarea",
    required: true,
    hint: "Modalities, manual therapy, exercise progression.",
  },
  { key: "progress_summary", label: "Progress during treatment", kind: "textarea" },
  {
    key: "condition_on_discharge",
    label: "Condition on discharge",
    kind: "textarea",
    required: true,
  },
  { key: "home_programme", label: "Home exercise programme", kind: "list" },
  { key: "follow_up_advice", label: "Follow-up advice", kind: "textarea" },
  { key: "precautions", label: "Precautions", kind: "textarea" },
];

const DISCHARGE_BODY = `
{{#if diagnosis}}<section class="field"><h2>Diagnosis</h2><div class="body">{{{diagnosis}}}</div></section>{{/if}}
{{#if referred_by}}<section class="field"><h2>Referred by</h2><div class="body">{{referred_by}}</div></section>{{/if}}
{{#if presenting_complaint}}<section class="field"><h2>Presenting complaint</h2><div class="body">{{{presenting_complaint}}}</div></section>{{/if}}
{{#if assessment_findings}}<section class="field"><h2>Assessment findings</h2><div class="body">{{{assessment_findings}}}</div></section>{{/if}}
{{#if outcome_measures}}<section class="field"><h2>Outcome measures</h2><div class="body">{{outcome_measures}}</div></section>{{/if}}
{{#if treatment_provided}}<section class="field"><h2>Treatment provided</h2><div class="body">{{{treatment_provided}}}</div></section>{{/if}}
{{#if progress_summary}}<section class="field"><h2>Progress during treatment</h2><div class="body">{{{progress_summary}}}</div></section>{{/if}}
{{#if condition_on_discharge}}<section class="field"><h2>Condition on discharge</h2><div class="body">{{{condition_on_discharge}}}</div></section>{{/if}}
{{#if home_programme}}<section class="field"><h2>Home exercise programme</h2><div class="body">{{home_programme}}</div></section>{{/if}}
{{#if precautions}}<section class="field"><h2>Precautions</h2><div class="body">{{{precautions}}}</div></section>{{/if}}
{{#if follow_up_advice}}<section class="field"><h2>Follow-up advice</h2><div class="body">{{{follow_up_advice}}}</div></section>{{/if}}
`.trim();

const CERTIFICATE_FIELDS = [
  { key: "diagnosis", label: "Condition treated", kind: "text", required: true },
  { key: "treatment_period", label: "Treatment period", kind: "text", required: true },
  { key: "statement", label: "Statement", kind: "textarea", required: true,
    defaultValue:
      "This is to certify that the above-named patient has been under my care for the condition stated and, in my professional opinion, is fit to resume normal duties with effect from the date below." },
  { key: "restrictions", label: "Restrictions / modified duties", kind: "textarea" },
  { key: "effective_from", label: "Effective from", kind: "date" },
];

const HEP_FIELDS = [
  { key: "goal", label: "Goal of this programme", kind: "textarea" },
  { key: "exercises", label: "Exercises", kind: "list", required: true,
    hint: "One per line: name, sets × reps, frequency." },
  { key: "precautions", label: "Precautions", kind: "textarea" },
  { key: "review_date", label: "Review on", kind: "date" },
];

const REFERRAL_FIELDS = [
  { key: "addressed_to", label: "Addressed to", kind: "text", required: true },
  { key: "reason", label: "Reason for referral", kind: "textarea", required: true },
  { key: "findings", label: "Relevant findings", kind: "textarea" },
  { key: "treatment_so_far", label: "Treatment provided so far", kind: "textarea" },
];

export const SEED_TEMPLATES = [
  {
    type: "DISCHARGE_SUMMARY",
    name: "Physiotherapy Discharge Summary",
    fields: DISCHARGE_FIELDS,
    bodyHtml: DISCHARGE_BODY,
  },
  { type: "FITNESS_CERTIFICATE", name: "Fitness Certificate", fields: CERTIFICATE_FIELDS, bodyHtml: "" },
  { type: "HOME_EXERCISE_PROGRAMME", name: "Home Exercise Programme", fields: HEP_FIELDS, bodyHtml: "" },
  { type: "REFERRAL_LETTER", name: "Referral Letter", fields: REFERRAL_FIELDS, bodyHtml: "" },
];
