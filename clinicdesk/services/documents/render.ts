import {
  letterheadCss,
  mastheadHtml,
  footerHtml,
  signatureBlockHtml,
  type LetterheadLike,
} from "@/services/letterhead/render";
import { escapeHtml, renderTemplate, type DocumentData, type TemplateField } from "./template";
import { formatDateIn } from "@/services/scheduling/timezone";

export type RenderContext = {
  clinic: { name: string; timezone: string; locale: string };
  patient: {
    fullName: string;
    patientNo: string;
    sex?: string | null;
    dateOfBirth?: Date | null;
    phoneE164?: string | null;
  };
  practitioner: { fullName: string; qualifications?: string | null };
  document: {
    title: string;
    documentNo?: string | null;
    type: string;
    createdAt: Date;
    finalisedAt?: Date | null;
    status: string;
  };
  letterhead: LetterheadLike;
  fields: TemplateField[];
  data: DocumentData;
  bodyHtml?: string | null;
};

function ageFrom(dob?: Date | null): string | null {
  if (!dob) return null;
  const now = new Date();
  let years = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) years -= 1;
  return `${years} yrs`;
}

function patientStrip(ctx: RenderContext): string {
  const dateLabel = formatDateIn(
    ctx.document.finalisedAt ?? ctx.document.createdAt,
    ctx.clinic.timezone,
    ctx.clinic.locale,
  );
  const ageSex = [ageFrom(ctx.patient.dateOfBirth), ctx.patient.sex && ctx.patient.sex !== "UNDISCLOSED" ? titleCase(ctx.patient.sex) : null]
    .filter(Boolean)
    .join(" · ");

  const rows: Array<[string, string | null]> = [
    ["Patient", ctx.patient.fullName],
    ["Date", dateLabel],
    ["Patient ID", ctx.patient.patientNo],
    ["Age / Sex", ageSex || null],
    ["Practitioner", [ctx.practitioner.fullName, ctx.practitioner.qualifications].filter(Boolean).join(", ")],
    ["Contact", ctx.patient.phoneE164 ?? null],
  ];

  return `<div class="patient-strip">
    ${rows
      .filter(([, value]) => Boolean(value))
      .map(
        ([key, value]) =>
          `<div><span class="k">${escapeHtml(key)}:</span> <span class="v">${escapeHtml(value)}</span></div>`,
      )
      .join("")}
  </div>`;
}

function titleCase(value: string) {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/**
 * Falls back to rendering the template's declared fields in order when a
 * template has no custom body. A clinic that never touches the template editor
 * still gets a correctly laid-out document.
 */
function defaultBody(fields: TemplateField[]): string {
  return fields
    .map(
      (field) => `{{#if ${field.key}}}<section class="field">
        <h2>${escapeHtml(field.label)}</h2>
        <div class="body">{{{${field.key}}}}</div>
      </section>{{/if}}`,
    )
    .join("\n");
}

/** Full standalone HTML for a clinical document — used for both preview and PDF. */
export function renderDocumentHtml(ctx: RenderContext): string {
  const body = renderTemplate(ctx.bodyHtml?.trim() || defaultBody(ctx.fields), ctx.data);
  const isDraft = ctx.document.status === "DRAFT";

  const signedOn = ctx.document.finalisedAt
    ? `Signed ${formatDateIn(ctx.document.finalisedAt, ctx.clinic.timezone, ctx.clinic.locale)}`
    : undefined;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(ctx.document.title)}${ctx.document.documentNo ? ` — ${escapeHtml(ctx.document.documentNo)}` : ""}</title>
  <style>${letterheadCss(ctx.letterhead)}</style>
</head>
<body>
  ${isDraft ? `<div class="draft-watermark">DRAFT</div>` : ""}
  ${mastheadHtml(ctx.letterhead)}
  <h1 class="doc-title">${escapeHtml(ctx.document.title)}</h1>
  ${ctx.document.documentNo ? `<div class="doc-no">${escapeHtml(ctx.document.documentNo)}</div>` : ""}
  ${patientStrip(ctx)}
  <main>${body}</main>
  ${signatureBlockHtml(ctx.letterhead, signedOn)}
  ${footerHtml(ctx.letterhead)}
</body>
</html>`;
}
