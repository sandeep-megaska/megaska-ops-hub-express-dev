import { escapeHtml } from "@/services/documents/template";
import type { Letterhead } from "@/generated/prisma";

/**
 * Letterhead rendering.
 *
 * The pilot's current workflow is "type the summary, print it on my letterhead",
 * so the letterhead is a tenant asset with three honest modes:
 *
 *  DIGITAL             compose the masthead from structured fields + logo
 *  PRE_PRINTED         print content only, leaving her physical stationery's
 *                      header and footer areas clear
 *  SCANNED_BACKGROUND  drop a scan of her existing letterhead behind the page
 *
 * The first-page masthead lives in the document body so it appears once.
 * Continuation headers and page numbers are handled by Chromium's own
 * header/footer templates (see pdf.ts), which is the only reliable way to
 * repeat them on every page.
 */

export type LetterheadLike = Pick<
  Letterhead,
  | "mode"
  | "practiceName"
  | "practitionerLine"
  | "registrationNo"
  | "headerLines"
  | "footerLines"
  | "logoUrl"
  | "backgroundUrl"
  | "marginTopMm"
  | "marginRightMm"
  | "marginBottomMm"
  | "marginLeftMm"
  | "signatureImageUrl"
  | "signatureName"
  | "signatureSubtitle"
  | "wetSignature"
>;

export type PageMargins = { top: string; right: string; bottom: string; left: string };

/**
 * Margins passed to Chromium. The repeating header and footer are drawn inside
 * the page margin, so the top and bottom need headroom beyond the letterhead's
 * own — otherwise the running header prints on top of the first line of text.
 */
export function pdfMargins(letterhead: LetterheadLike, withRunningHeader: boolean): PageMargins {
  const extraTop = withRunningHeader ? 10 : 0;
  const extraBottom = withRunningHeader ? 8 : 0;
  return {
    top: `${letterhead.marginTopMm + extraTop}mm`,
    right: `${letterhead.marginRightMm}mm`,
    bottom: `${letterhead.marginBottomMm + extraBottom}mm`,
    left: `${letterhead.marginLeftMm}mm`,
  };
}

export function mastheadHtml(letterhead: LetterheadLike): string {
  // Pre-printed stationery already carries the practice's header in ink.
  if (letterhead.mode === "PRE_PRINTED") return "";
  if (letterhead.mode === "SCANNED_BACKGROUND") return "";

  const logo = letterhead.logoUrl
    ? `<img class="lh-logo" src="${escapeHtml(letterhead.logoUrl)}" alt="" />`
    : "";

  const lines = [
    letterhead.practitionerLine,
    ...(letterhead.headerLines ?? []),
    letterhead.registrationNo ? `Reg. No. ${letterhead.registrationNo}` : null,
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => `<div class="lh-line">${escapeHtml(line)}</div>`)
    .join("");

  return `<header class="letterhead">
    ${logo}
    <div class="lh-text">
      ${letterhead.practiceName ? `<div class="lh-name">${escapeHtml(letterhead.practiceName)}</div>` : ""}
      ${lines}
    </div>
  </header>
  <hr class="lh-rule" />`;
}

export function footerHtml(letterhead: LetterheadLike): string {
  if (letterhead.mode !== "DIGITAL") return "";
  const lines = (letterhead.footerLines ?? []).filter((l) => l && l.trim());
  if (lines.length === 0) return "";
  return `<footer class="lh-footer">${lines.map((l) => escapeHtml(l)).join(" &nbsp;·&nbsp; ")}</footer>`;
}

/**
 * Signature block. Defaults to leaving space for a wet signature — she prints
 * and signs today, and an auto-applied signature image on a clinical document
 * is a claim about authorship that should be opt-in.
 */
export function signatureBlockHtml(letterhead: LetterheadLike, signedOnLabel?: string): string {
  const image =
    !letterhead.wetSignature && letterhead.signatureImageUrl
      ? `<img class="sig-img" src="${escapeHtml(letterhead.signatureImageUrl)}" alt="" />`
      : `<div class="sig-space"></div>`;

  return `<div class="signature-block">
    ${image}
    <div class="sig-rule"></div>
    ${letterhead.signatureName ? `<div class="sig-name">${escapeHtml(letterhead.signatureName)}</div>` : ""}
    ${letterhead.signatureSubtitle ? `<div class="sig-sub">${escapeHtml(letterhead.signatureSubtitle)}</div>` : ""}
    ${signedOnLabel ? `<div class="sig-sub">${escapeHtml(signedOnLabel)}</div>` : ""}
  </div>`;
}

export function letterheadCss(letterhead: LetterheadLike): string {
  const background =
    letterhead.mode === "SCANNED_BACKGROUND" && letterhead.backgroundUrl
      ? `body::before {
          content: "";
          position: fixed;
          inset: 0;
          background-image: url("${letterhead.backgroundUrl}");
          background-size: 100% 100%;
          background-repeat: no-repeat;
          z-index: -1;
        }`
      : "";

  return `
    :root {
      --ink: #14181f;
      --muted: #5b6472;
      --rule: #c9d0d9;
      --accent: #0f766e;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      font-family: "Source Serif 4", Georgia, "Times New Roman", serif;
      font-size: 11.5pt;
      line-height: 1.5;
      color: var(--ink);
      background: #fff;
    }

    ${background}

    .letterhead {
      display: flex;
      align-items: center;
      gap: 14px;
      padding-bottom: 6px;
    }
    .lh-logo { height: 58px; width: auto; }
    .lh-name {
      font-size: 17pt;
      font-weight: 700;
      letter-spacing: 0.01em;
      color: var(--accent);
    }
    .lh-line { font-size: 9.5pt; color: var(--muted); line-height: 1.35; }
    .lh-rule {
      border: 0;
      border-top: 1.5px solid var(--accent);
      margin: 6px 0 16px;
    }
    .lh-footer {
      margin-top: 22px;
      padding-top: 6px;
      border-top: 1px solid var(--rule);
      font-size: 8.5pt;
      color: var(--muted);
      text-align: center;
    }

    .doc-title {
      text-align: center;
      font-size: 13pt;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      margin: 0 0 4px;
    }
    .doc-no {
      text-align: center;
      font-size: 9pt;
      color: var(--muted);
      margin-bottom: 16px;
    }

    .patient-strip {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 2px 24px;
      border: 1px solid var(--rule);
      border-radius: 3px;
      padding: 9px 12px;
      margin-bottom: 18px;
      font-size: 10pt;
      /* A patient identity block split across a page break is a safety problem. */
      break-inside: avoid;
    }
    .patient-strip .k { color: var(--muted); }
    .patient-strip .v { font-weight: 600; }

    section.field { margin-bottom: 13px; break-inside: avoid; }
    section.field > h2 {
      font-size: 9.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--accent);
      margin: 0 0 3px;
    }
    section.field > .body { margin: 0; }
    section.field ul { margin: 2px 0 0; padding-left: 18px; }
    section.field li { margin-bottom: 2px; }

    table.measures {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 10pt;
      break-inside: avoid;
    }
    table.measures th,
    table.measures td {
      border: 1px solid var(--rule);
      padding: 4px 7px;
      text-align: left;
    }
    table.measures th {
      background: #f2f5f7;
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    table.measures .num { text-align: center; width: 22%; }

    .signature-block {
      margin-top: 34px;
      width: 62mm;
      break-inside: avoid;
      /* Never strand a signature alone on a trailing page. */
      page-break-inside: avoid;
    }
    .sig-space { height: 17mm; }
    .sig-img { height: 17mm; width: auto; display: block; }
    .sig-rule { border-top: 1px solid var(--ink); margin-bottom: 4px; }
    .sig-name { font-weight: 700; font-size: 10pt; }
    .sig-sub { font-size: 8.5pt; color: var(--muted); }

    .draft-watermark {
      position: fixed;
      top: 45%;
      left: 0;
      right: 0;
      text-align: center;
      font-size: 64pt;
      font-weight: 700;
      color: rgba(15, 118, 110, 0.08);
      letter-spacing: 0.2em;
      transform: rotate(-22deg);
      z-index: 0;
      pointer-events: none;
    }

    @media print {
      .no-print { display: none !important; }
    }
  `;
}

/**
 * Chromium's repeating header. Continuation pages must re-identify the patient
 * and document — a loose page 2 with no name on it is a clinical hazard, and
 * it's expected practice for multi-page records.
 */
export function runningHeaderTemplate(params: {
  patientName: string;
  patientNo: string;
  documentTitle: string;
  documentNo?: string | null;
}) {
  const right = [params.documentTitle, params.documentNo].filter(Boolean).join(" · ");
  return `<div style="
      font-family: Georgia, serif; font-size: 7.5pt; color: #5b6472;
      width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;
    ">
      <span>${escapeHtml(params.patientName)} (${escapeHtml(params.patientNo)})</span>
      <span>${escapeHtml(right)}</span>
    </div>`;
}

export function runningFooterTemplate(clinicName: string) {
  return `<div style="
      font-family: Georgia, serif; font-size: 7.5pt; color: #5b6472;
      width: 100%; padding: 0 18mm; display: flex; justify-content: space-between;
    ">
      <span>${escapeHtml(clinicName)}</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;
}
