# Row-Level Security

`clinicScope()` in `lib/db.ts` filters every query in the application layer.
These policies are the second line of defence: if a query ever escapes the
scope — a raw `$queryRaw`, a new model someone forgot to add to `TENANT_MODELS`,
a bug in the extension — Postgres itself returns zero rows instead of another
clinic's patient records.

Apply it **before** the first real patient is entered.

## How it works

The app connects as a non-superuser role with `FORCE ROW LEVEL SECURITY`. Each
request sets `app.clinic_id` for the duration of its transaction, and every
policy compares that against the row's `clinicId`.

## The superuser trap

**A superuser bypasses RLS entirely, even with `FORCE ROW LEVEL SECURITY`.**
Verifying these policies while connected as `postgres` shows every row and looks
like the policies do nothing — the policies are fine, the test is wrong. The
application must connect as a non-superuser role that does not own the tables.

Verified behaviour as a non-owner role (`SELECT count(*) FROM "Patient"`):

| Connection | Rows |
|---|---|
| `app.clinic_id` unset | 0 |
| `app.clinic_id` = the clinic's id | 3 |
| `app.clinic_id` = another uuid | 0 |

## Applying

```bash
psql "$DATABASE_URL" -f prisma/rls/generate-policies.sql
```

It is idempotent — re-run it after adding a tenant-scoped model.

## Wiring the app

RLS needs the setting to be present on the same connection as the query, which
means running inside a transaction:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinicId}, true)`;
  // ... queries here see only this clinic's rows
});
```

This is deliberately **not** enabled by default: it changes the connection model
(every read becomes a transaction) and wants a load test before it goes live.
Turn it on as a dedicated piece of work, not as part of a feature branch.
