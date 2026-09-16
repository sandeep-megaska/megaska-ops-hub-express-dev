/**
 * Consent text shown at booking, versioned.
 *
 * Lives outside the server-actions module because a `"use server"` file may
 * only export async functions. Kept versioned and snapshotted onto each
 * `Consent` row: under the DPDP Act the exact wording a patient agreed to has
 * to be reproducible later, so changing this string means a new version, never
 * an edit in place.
 */
export const CONSENT_VERSION = "2026-09-v1";

export const CONSENT_TEXT =
  "I consent to this clinic storing my personal and health information for the purpose of " +
  "providing physiotherapy care, and to being contacted about my appointments. I understand " +
  "I can ask for a copy of my records or for them to be deleted at any time.";
