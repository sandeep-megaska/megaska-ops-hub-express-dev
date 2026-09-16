# ClinicDesk

Multi-tenant clinic OS for allied-health practices — physiotherapy, chiropractic,
speech and language therapy, dietetics. Booking, clinical documents and billing,
with each clinic getting its own booking surface, letterhead and records.

Built for a pilot physiotherapy clinic in Kochi whose patients are split between
India and abroad, and designed so clinic #2 is a settings screen rather than a
development project.

> **Working name.** `clinicdesk` and the `heal` tenant slug are placeholders.
> Renaming is a find-and-replace plus `SEED_CLINIC_SLUG`.

## What works today

| Surface | Route |
|---|---|
| Public booking page | `/book/:slug` |
| Embeddable widget | `<script src="/api/embed/:slug">` |
| Practitioner console | `/console` |
| Patient document link | `/d/:token` |

- **Booking** — service → time → details → confirm, four steps, no account. Real
  availability from weekly rules minus appointments and blocks. Slots render in
  the patient's own timezone alongside clinic time.
- **Clinical documents** — one engine, many types. Structured fields → versioned
  template → A4 PDF on the clinic's letterhead. Immutable once finalised;
  corrections supersede. "Start from a previous summary" carries the structure
  forward and drops the other patient's clinical detail.
- **Billing** — payment receipts and session packages. **No GST logic**: health
  care services are exempt and the pilot is unregistered.
- **Messaging** — confirmations and a reminder ladder, queued per tenant. Logs to
  stdout until a WhatsApp provider is configured.

## Quick start

```bash
npm install
cp .env.example .env          # point DATABASE_URL at a Postgres
npx prisma db push
npm run db:seed
npm run dev
```

Then sign in at `/console/login` as `anjali@healphysiotherapy.in` — with
`DEV_LOGIN_CODES=true` the six-digit code is printed to the server log.

```bash
npm test          # unit + database integration
npm run typecheck
npm run lint
```

## Architecture

**Tenancy.** One Postgres database, `clinicId` on every tenant-owned row.
`clinicScope(clinicId)` in `lib/db.ts` returns a Prisma client that injects the
filter on every read and verifies it on every write, and refuses `findUnique` on
tenant models because a unique lookup would bypass the filter. See
`lib/tenant-scope.test.mts`. `prisma/rls/` adds Postgres row-level security as a
second line of defence — apply it before the first real patient.

**Tenant resolution.** `proxy.ts` (Next 16 renamed `middleware` → `proxy`) maps
`app.<root>` to the console, `<slug>.<root>` to a clinic's booking site, and any
other host to a custom-domain lookup against verified `ClinicDomain` rows.

**Time.** Instants are UTC. Availability is authored in clinic wall-clock time
and resolved per-day, so a 9am clinic stays 9am across a DST change. Everything
that converts lives in `services/scheduling/timezone.ts`.

**Documents.** `DocumentTemplate` holds fields + body; `ClinicalDocument` holds
the structured data, which is the source of truth. The PDF is a projection.
Finalising snapshots the rendered HTML so a later template edit cannot rewrite
history. Continuation headers and page numbers come from Chromium's own header
templates — CSS running elements are not supported.

**AI drafting** is optional (`ANTHROPIC_API_KEY`). Patient identifiers are
stripped before the request by `services/documents/ai-draft-deidentify.ts` and
re-inserted locally by the template. Output is always a draft for the
practitioner to correct and sign.

## Reused from megaska-ops-hub

The tenant pattern, per-merchant provider settings, document numbering, the
Chromium PDF pipeline and signed document URLs all follow patterns proven in the
ops-hub repo. Deliberately **not** ported: the GST tax engine, HSN classification
and tax reconciliation — none of it applies to exempt healthcare supply.

Extract shared packages at customer #3, not before.

## Onboarding clinic #2

The bar: spin up a second tenant and touch no code. Currently done through the
seed; the gap to close is a self-serve onboarding wizard for branding, services,
hours, letterhead and the embed snippet.

## Lifting into its own repo

This lives inside `megaska-ops-hub-express-dev` only because that was the
writable repo. To split it out with history:

```bash
git subtree split --prefix=clinicdesk -b clinicdesk-only
# then push that branch to the new repo's main
```

Or without history: copy the directory into a fresh repo and `npm install`.
Nothing here imports from the parent project.
