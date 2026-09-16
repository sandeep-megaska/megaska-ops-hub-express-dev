import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/index.js";

declare global {
  var __clinicdeskPrisma: PrismaClient | undefined;
}

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

/**
 * The unscoped client. Only platform-level code may use this directly:
 * tenant resolution, login, migrations, cron. Everything that touches patient
 * data goes through `clinicScope()`.
 */
export const prisma = globalThis.__clinicdeskPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__clinicdeskPrisma = prisma;

/**
 * Every model carrying a `clinicId`. Adding a tenant-owned model without
 * listing it here is the one mistake that silently leaks data across clinics,
 * so `npm run typecheck` fails if this drifts — see the assertion below.
 */
export const TENANT_MODELS = [
  "ClinicDomain",
  "ClinicSettings",
  "Letterhead",
  "StaffUser",
  "Practitioner",
  "Service",
  "AvailabilityRule",
  "ScheduleException",
  "Patient",
  "Consent",
  "Episode",
  "Appointment",
  "VisitNote",
  "DocumentTemplate",
  "ClinicalDocument",
  "DocumentShareLink",
  "DocumentCounter",
  "SessionPackage",
  "Bill",
  "Payment",
  "AuditEvent",
  "NotificationLog",
] as const;

const TENANT_MODEL_SET: ReadonlySet<string> = new Set(TENANT_MODELS);

/** Operations whose `where` we can safely narrow with `clinicId`. */
const FILTERED_OPS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

/**
 * Operations that write new rows.
 *
 * These *verify* rather than silently inject: Prisma's generated create types
 * already require `clinicId`, so leaving it out is a compile error, and a
 * mismatch against the active scope is a runtime error. Reads are the opposite
 * case — `where` is optional in the types, so a forgotten filter compiles
 * happily, which is why those get injected below.
 */
const CREATE_OPS = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);

/**
 * `findUnique` resolves by unique key alone, so an injected `clinicId` would be
 * ignored and one clinic could read another's row by guessing an id. Rather
 * than silently degrade, we refuse it and point at the safe alternative.
 */
const REJECTED_OPS = new Set(["findUnique", "findUniqueOrThrow"]);

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

function withClinicId(where: unknown, clinicId: string) {
  const base = (where && typeof where === "object" ? where : {}) as Record<string, unknown>;
  if ("clinicId" in base && base.clinicId !== clinicId) {
    throw new TenantScopeError(
      `Query carried clinicId=${String(base.clinicId)} inside a scope for ${clinicId}.`,
    );
  }
  return { ...base, clinicId };
}

function withClinicData(data: unknown, clinicId: string): unknown {
  if (Array.isArray(data)) return data.map((row) => withClinicData(row, clinicId));
  const base = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if ("clinicId" in base && base.clinicId !== clinicId) {
    throw new TenantScopeError(
      `Write carried clinicId=${String(base.clinicId)} inside a scope for ${clinicId}.`,
    );
  }
  return { ...base, clinicId };
}

export type ClinicScopedClient = ReturnType<typeof clinicScope>;

/**
 * Returns a Prisma client pinned to one clinic. Every read is filtered and
 * every write is stamped, whether or not the calling code remembers to.
 *
 * ```ts
 * const db = clinicScope(clinicId);
 * await db.patient.findMany();          // WHERE "clinicId" = $1
 * await db.patient.create({ data: {} }); // clinicId stamped in
 * ```
 *
 * This is belt-and-braces with the Postgres RLS policies in
 * `prisma/migrations/rls/` — apply those before going live with real patients.
 */
export function clinicScope(clinicId: string) {
  if (!clinicId) throw new TenantScopeError("clinicScope() requires a clinicId.");

  return prisma.$extends({
    name: `clinic-scope:${clinicId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODEL_SET.has(model)) return query(args);

          if (REJECTED_OPS.has(operation)) {
            throw new TenantScopeError(
              `${operation} is not allowed on tenant model ${model} — a unique lookup ` +
                `bypasses the clinic filter. Use findFirst({ where: { id } }) instead.`,
            );
          }

          const next = { ...(args as Record<string, unknown>) };

          if (FILTERED_OPS.has(operation)) {
            next.where = withClinicId(next.where, clinicId);
          }

          if (CREATE_OPS.has(operation)) {
            if (operation === "upsert") {
              next.create = withClinicData(next.create, clinicId);
            } else if (next.data !== undefined) {
              next.data = withClinicData(next.data, clinicId);
            }
          }

          return query(next);
        },
      },
    },
  });
}
