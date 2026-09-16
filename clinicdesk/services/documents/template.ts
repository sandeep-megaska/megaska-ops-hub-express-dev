/**
 * A deliberately tiny template language.
 *
 * Clinic templates are tenant-authored content rendered server-side into a PDF.
 * A general-purpose engine would be a server-side template injection hole, so
 * this supports exactly four constructs and escapes everything by default:
 *
 *   {{field}}                 value, HTML-escaped
 *   {{{field}}}               value, newlines to <br> (still escaped)
 *   {{#if field}}…{{/if}}     omit empty sections — a summary should not print
 *                             "Complications: " with nothing after it
 *   {{#each field}}…{{/each}} list items, {{.}} for the item
 *
 * Unknown fields render empty rather than throwing: a template edited to
 * reference a field that no longer exists must not break an existing document.
 */

export type FieldKind = "text" | "textarea" | "date" | "list" | "measures" | "number";

export type TemplateField = {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  required?: boolean;
  defaultValue?: string | string[];
  /** Fields sharing a group render side by side in the editor. */
  group?: string;
};

export type Measure = { code: string; label: string; initial?: string; current?: string };

export type DocumentData = Record<string, string | string[] | Measure[] | undefined>;

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(value: unknown): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function isEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return String(value).trim() === "";
}

function lookup(data: DocumentData, key: string): unknown {
  if (key === "." || key === "this") return undefined;
  return data[key];
}

function renderMeasures(measures: Measure[]): string {
  if (measures.length === 0) return "";
  const rows = measures
    .map(
      (m) => `<tr>
        <td>${escapeHtml(m.label || m.code)}</td>
        <td class="num">${escapeHtml(m.initial ?? "—")}</td>
        <td class="num">${escapeHtml(m.current ?? "—")}</td>
      </tr>`,
    )
    .join("");
  return `<table class="measures">
    <thead><tr><th>Outcome measure</th><th class="num">At assessment</th><th class="num">At discharge</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function renderValue(value: unknown, raw: boolean): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (typeof value[0] === "object") return renderMeasures(value as Measure[]);
    return `<ul>${(value as string[]).map((v) => `<li>${escapeHtml(v)}</li>`).join("")}</ul>`;
  }
  return raw ? nl2br(value) : escapeHtml(value);
}

export function renderTemplate(body: string, data: DocumentData): string {
  let output = body;

  // {{#each key}}…{{/each}}
  output = output.replace(
    /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_match, key: string, inner: string) => {
      const value = lookup(data, key);
      if (!Array.isArray(value)) return "";
      return value
        .map((item) =>
          inner.replace(/\{\{\s*(?:\.|this)\s*\}\}/g, () =>
            typeof item === "object" ? "" : escapeHtml(item),
          ),
        )
        .join("");
    },
  );

  // {{#if key}}…{{/if}}
  output = output.replace(
    /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, key: string, inner: string) => (isEmpty(lookup(data, key)) ? "" : inner),
  );

  // {{{key}}} — preserve the author's line breaks
  output = output.replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_match, key: string) =>
    renderValue(lookup(data, key), true),
  );

  // {{key}}
  output = output.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key: string) =>
    renderValue(lookup(data, key), false),
  );

  return output;
}

/** Fields the practitioner left blank but marked required — surfaced before finalising. */
export function missingRequiredFields(fields: TemplateField[], data: DocumentData) {
  return fields.filter((field) => field.required && isEmpty(data[field.key])).map((f) => f.label);
}
