import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { clinicScope } from "@/lib/db";
import { recordAudit } from "@/lib/audit";
import { deidentify } from "./ai-draft-deidentify";

/**
 * Drafts a discharge-summary narrative from the episode's visit notes.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **No patient identifiers leave the building.** Name, phone, email and date
 *    of birth are stripped before the request and never re-sent; the clinical
 *    narrative doesn't need them, and removing them takes a whole category of
 *    legal exposure off the table. Identifiers are re-inserted locally by the
 *    document template, which already has them.
 *
 * 2. **The output is a draft, never a signature.** It lands in the editor for
 *    the practitioner to correct and finalise. Nothing here writes a finalised
 *    document or sends anything to a patient.
 */

const DraftSchema = z.object({
  presenting_complaint: z.string(),
  assessment_findings: z.string(),
  treatment_provided: z.string(),
  progress_summary: z.string(),
  condition_on_discharge: z.string(),
  home_programme: z.array(z.string()),
  follow_up_advice: z.string(),
});

export type DischargeDraft = z.infer<typeof DraftSchema>;

export class AiDraftUnavailable extends Error {
  constructor() {
    super("AI drafting is not configured — set ANTHROPIC_API_KEY to enable it.");
    this.name = "AiDraftUnavailable";
  }
}

export function aiDraftEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draftDischargeSummary(params: {
  clinicId: string;
  episodeId: string;
  actorStaffUserId?: string | null;
}): Promise<DischargeDraft> {
  if (!aiDraftEnabled()) throw new AiDraftUnavailable();

  const db = clinicScope(params.clinicId);
  const episode = await db.episode.findFirst({
    where: { id: params.episodeId },
    include: {
      patient: true,
      practitioner: true,
      visitNotes: { orderBy: { visitDate: "asc" } },
    },
  });
  if (!episode) throw new Error("Episode not found.");

  const identifiers = [
    episode.patient.fullName,
    ...episode.patient.fullName.split(/\s+/),
    episode.patient.phoneE164,
    episode.patient.email,
  ];

  const notes = episode.visitNotes
    .map((note, index) => {
      const measures = Array.isArray(note.measures)
        ? (note.measures as Array<{ label?: string; value?: string }>)
            .map((m) => `${m.label ?? ""}: ${m.value ?? ""}`)
            .join("; ")
        : "";
      return [
        `Visit ${index + 1} (${note.visitDate.toISOString().slice(0, 10)}):`,
        note.subjective && `  S: ${note.subjective}`,
        note.objective && `  O: ${note.objective}`,
        measures && `  Measures: ${measures}`,
        note.assessment && `  A: ${note.assessment}`,
        note.plan && `  P: ${note.plan}`,
        note.interventions.length ? `  Interventions: ${note.interventions.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  const context = deidentify(
    [
      `Episode: ${episode.title}`,
      episode.presentingComplaint && `Presenting complaint: ${episode.presentingComplaint}`,
      episode.provisionalDiagnosis && `Provisional diagnosis: ${episode.provisionalDiagnosis}`,
      `Visits recorded: ${episode.visitNotes.length}`,
      "",
      notes || "(No visit notes recorded yet.)",
    ]
      .filter(Boolean)
      .join("\n"),
    identifiers,
  );

  const client = new Anthropic();

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: [
      "You draft physiotherapy discharge summaries for a qualified physiotherapist to review, correct and sign.",
      "",
      "Rules:",
      "- Write only what the visit notes support. Never invent findings, measurements, dates or diagnoses.",
      "- Where the notes are silent, write a short, neutral sentence saying so rather than filling the gap.",
      "- Use plain clinical English suited to a referring doctor and the patient's own file.",
      "- The text is placed on the clinic's letterhead, so do not add greetings, headers, sign-offs or the clinic's name.",
      "- The record is de-identified. Do not invent a patient name or reintroduce identifiers.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: `Draft a discharge summary from these de-identified physiotherapy records.\n\n${context}`,
      },
    ],
    output_config: { format: zodOutputFormat(DraftSchema) },
  });

  await recordAudit({
    clinicId: params.clinicId,
    action: "UPDATE",
    resourceType: "Episode",
    resourceId: episode.id,
    patientId: episode.patientId,
    actorStaffUserId: params.actorStaffUserId ?? null,
    metadata: { aiDraft: true, visitNotes: episode.visitNotes.length },
  });

  if (!response.parsed_output) {
    throw new Error("The draft came back unreadable. Please try again.");
  }
  return response.parsed_output;
}
