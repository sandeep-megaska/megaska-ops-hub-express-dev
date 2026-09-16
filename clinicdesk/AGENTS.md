<!-- BEGIN:nextjs-agent-rules -->

# Next.js: ALWAYS read docs before coding

Before any Next.js work, find and read the relevant doc in `node_modules/next/dist/docs/`. Your training data is outdated — the docs are the source of truth.

<!-- END:nextjs-agent-rules -->

# ClinicDesk conventions

- **Tenant isolation is the top invariant.** Never query a tenant-scoped model
  through the raw Prisma client. Always go through `clinicScope(clinicId)` from
  `lib/db.ts`, which injects and enforces `clinicId` on every read and write.
  A missing filter on patient data is a reportable breach, not a bug.
- **Clinical documents are immutable once finalised.** Corrections create a
  superseding version (`supersedesId`); never mutate a finalised record.
- **No patient-identifying data in model prompts.** `services/documents/ai-draft.ts`
  de-identifies before calling out and re-inserts identifiers locally.
- This product has **no GST/tax logic**. Healthcare services are GST-exempt and
  the pilot clinic is unregistered. `Clinic.taxProfile` is a nullable placeholder
  for a future registered tenant — do not build tax computation into the core.
- Times are stored UTC (`timestamptz`). Clinic wall-clock lives in
  `Clinic.timezone`; always render through `services/scheduling/timezone.ts`.
