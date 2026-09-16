/**
 * Strips anything that could identify a patient before clinical text is sent to
 * a model endpoint.
 *
 * Kept in its own module, free of SDK imports, so it is unit-testable without
 * credentials — this is the function that decides whether patient identifiers
 * leave the building, and it should never be untested.
 */
export function deidentify(text: string, identifiers: Array<string | null | undefined>) {
  let output = text;
  for (const value of identifiers) {
    if (!value || value.trim().length < 3) continue;
    const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escaped, "gi"), "[PATIENT]");
  }
  return output
    .replace(/\+?\d[\d\s-]{8,}\d/g, "[PHONE]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[EMAIL]");
}
