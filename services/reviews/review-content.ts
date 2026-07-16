export type NormalizedText = { value: string | null; error?: string };

function plainText(value: unknown, maximum: number, required: boolean): NormalizedText {
  if (value === undefined || value === null || value === "") return required ? { value: null, error: "This field is required." } : { value: null };
  if (typeof value !== "string") return { value: null, error: "This field must be text." };
  const normalized = value.normalize("NFC").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (/<\/?[a-z][^>]*>/i.test(normalized)) return { value: null, error: "HTML is not allowed." };
  if (!normalized || !normalized.replace(/[\s\p{Cf}\p{Z}]/gu, "")) return required ? { value: null, error: "This field cannot be empty." } : { value: null };
  if (normalized.length > maximum) return { value: null, error: `Must be ${maximum} characters or fewer.` };
  return { value: normalized };
}

export function normalizeReviewTitle(value: unknown): NormalizedText { return plainText(value, 150, false); }
export function normalizeReviewBody(value: unknown): NormalizedText { return plainText(value, 5000, false); }
export function normalizeReviewDisplayName(value: unknown): NormalizedText {
  const result = plainText(value, 100, true);
  if (result.error || !result.value) return result;
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/i.test(result.value) || /(?:\+?\d[\s().-]*){7,}\d/.test(result.value) || /\bhttps?:\/\//i.test(result.value)) return { value: null, error: "Use a name, not contact information." };
  if (/^loopdesk\s+admin$/i.test(result.value)) return { value: null, error: "Choose a different display name." };
  return result;
}
