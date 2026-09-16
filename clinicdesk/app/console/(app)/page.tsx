import Link from "next/link";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import {
  dateKeyIn,
  formatTimeIn,
  parseDateKey,
  zoneAbbreviation,
} from "@/services/scheduling/timezone";
import { zonedTimeToUtc } from "@/services/scheduling/timezone";

export const metadata = { title: "Today — ClinicDesk" };

const STATUS_STYLES: Record<string, string> = {
  REQUESTED: "bg-warn-soft text-warn",
  CONFIRMED: "bg-brand-soft text-brand-dark",
  ARRIVED: "bg-good-soft text-good",
  COMPLETED: "bg-surface-sunk text-ink-faint",
  CANCELLED: "bg-danger-soft text-danger",
  NO_SHOW: "bg-danger-soft text-danger",
};

/**
 * The home screen is today's list, not a dashboard of charts. The question a
 * practitioner opens this app to answer is "who is next, and what did we do
 * last time" — so the answer is on screen without a click.
 */
export default async function TodayPage() {
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);
  const tz = session.clinicTimezone;

  const todayKey = dateKeyIn(new Date(), tz);
  const { year, month, day } = parseDateKey(todayKey);
  const dayStart = zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, tz);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);

  const [appointments, openDrafts] = await Promise.all([
    db.appointment.findMany({
      where: { startAt: { gte: dayStart, lt: dayEnd }, status: { not: "CANCELLED" } },
      orderBy: { startAt: "asc" },
      include: {
        patient: { select: { id: true, fullName: true, patientNo: true, timezone: true } },
        service: { select: { name: true, isTeleconsult: true } },
        practitioner: { select: { fullName: true } },
        episode: { select: { id: true, title: true } },
      },
    }),
    db.clinicalDocument.findMany({
      where: { status: "DRAFT" },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        patient: { select: { fullName: true } },
      },
    }),
  ]);

  await recordAudit({
    clinicId: session.clinicId,
    action: "VIEW",
    resourceType: "Schedule",
    resourceId: todayKey,
    actorStaffUserId: session.staffUserId,
  });

  const heading = new Intl.DateTimeFormat(session.clinicLocale, {
    timeZone: tz,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <section>
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-xl font-bold">{heading}</h1>
          <span className="text-sm text-ink-faint">
            {appointments.length} appointment{appointments.length === 1 ? "" : "s"}
          </span>
        </div>

        {appointments.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink-soft">
            Nothing booked today.
          </p>
        ) : (
          <ol className="space-y-2">
            {appointments.map((appointment) => {
              const patientTz = appointment.patient.timezone ?? appointment.bookedTimezone;
              const showPatientTz = patientTz && patientTz !== tz;
              return (
                <li key={appointment.id} className="card p-3">
                  <div className="flex items-start gap-4">
                    <div className="w-20 shrink-0">
                      <div className="font-bold tabular-nums">
                        {formatTimeIn(appointment.startAt, tz, session.clinicLocale)}
                      </div>
                      {showPatientTz && (
                        <div className="text-[0.7rem] leading-tight text-ink-faint">
                          {formatTimeIn(appointment.startAt, patientTz, session.clinicLocale)}{" "}
                          {zoneAbbreviation(appointment.startAt, patientTz, session.clinicLocale)}
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/console/patients/${appointment.patient.id}`}
                        className="font-semibold hover:text-brand"
                      >
                        {appointment.patient.fullName}
                      </Link>
                      <span className="ml-2 text-xs text-ink-faint">
                        {appointment.patient.patientNo}
                      </span>
                      <div className="text-sm text-ink-soft">
                        {appointment.service.name}
                        {appointment.service.isTeleconsult && " · Video"}
                        {appointment.episode && ` · ${appointment.episode.title}`}
                      </div>
                      {appointment.reasonForVisit && (
                        <p className="mt-1 text-sm text-ink-faint">
                          “{appointment.reasonForVisit}”
                        </p>
                      )}
                    </div>

                    <span
                      className={`pill shrink-0 ${STATUS_STYLES[appointment.status] ?? "bg-surface-sunk text-ink-faint"}`}
                    >
                      {appointment.status.replace("_", " ")}
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <aside>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-ink-faint">
          Unfinished documents
        </h2>
        {openDrafts.length === 0 ? (
          <p className="card p-4 text-sm text-ink-faint">Nothing in draft.</p>
        ) : (
          <ul className="space-y-2">
            {openDrafts.map((draft) => (
              <li key={draft.id}>
                <Link
                  href={`/console/documents/${draft.id}`}
                  className="card block p-3 hover:border-brand"
                >
                  <div className="text-sm font-semibold">{draft.patient.fullName}</div>
                  <div className="text-xs text-ink-faint">{draft.title}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
