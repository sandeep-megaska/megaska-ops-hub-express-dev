import Link from "next/link";
import { notFound } from "next/navigation";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { recordAudit } from "@/lib/audit";
import { formatDateIn, formatDateTimeIn } from "@/services/scheduling/timezone";
import { recentDocumentsForReuse } from "@/services/documents/documents";
import { formatMinor } from "@/services/billing/bills";
import { startDocument } from "./actions";

export default async function PatientPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = await params;
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);
  const tz = session.clinicTimezone;
  const locale = session.clinicLocale;

  const patient = await db.patient.findFirst({
    where: { id: patientId },
    include: {
      episodes: {
        orderBy: { startedAt: "desc" },
        include: {
          visitNotes: { orderBy: { visitDate: "desc" } },
          practitioner: { select: { fullName: true } },
        },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          documentNo: true,
          createdAt: true,
          finalisedAt: true,
        },
      },
      packages: { where: { status: "ACTIVE" }, orderBy: { purchasedAt: "asc" } },
      bills: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!patient) notFound();

  // Reads are audited, not just writes — "who opened this chart" is the
  // question that gets asked after an incident.
  await recordAudit({
    clinicId: session.clinicId,
    action: "VIEW",
    resourceType: "Patient",
    resourceId: patient.id,
    patientId: patient.id,
    actorStaffUserId: session.staffUserId,
  });

  const reusable = await recentDocumentsForReuse(session.clinicId, "DISCHARGE_SUMMARY", 6);
  const activeEpisode = patient.episodes.find((episode) => episode.status === "ACTIVE");
  const outstanding = patient.bills.reduce(
    (sum, bill) => sum + Math.max(0, bill.totalMinor - bill.paidMinor),
    0,
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-6">
        <header>
          <Link href="/console/patients" className="text-sm text-ink-faint hover:text-ink">
            ← Patients
          </Link>
          <h1 className="mt-1 text-2xl font-bold">{patient.fullName}</h1>
          <p className="text-sm text-ink-soft">
            {patient.patientNo}
            {patient.phoneE164 && ` · ${patient.phoneE164}`}
            {patient.email && ` · ${patient.email}`}
          </p>
          {patient.allergies && patient.allergies.toLowerCase() !== "none known" && (
            <p className="mt-2 inline-flex rounded-lg bg-danger-soft px-3 py-1.5 text-sm font-semibold text-danger">
              Allergies: {patient.allergies}
            </p>
          )}
        </header>

        {patient.episodes.map((episode) => (
          <section key={episode.id} className="card p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold">{episode.title}</h2>
              <span
                className={`pill ${
                  episode.status === "ACTIVE" ? "bg-brand-soft text-brand-dark" : "bg-surface-sunk text-ink-faint"
                }`}
              >
                {episode.status}
              </span>
            </div>
            <p className="text-xs text-ink-faint">
              Started {formatDateIn(episode.startedAt, tz, locale)} ·{" "}
              {episode.visitNotes.length} visit{episode.visitNotes.length === 1 ? "" : "s"}
              {episode.practitioner && ` · ${episode.practitioner.fullName}`}
            </p>

            {episode.presentingComplaint && (
              <p className="mt-2 text-sm text-ink-soft">{episode.presentingComplaint}</p>
            )}

            {/* The last visit is expanded by default — it is what she needs
                before the patient sits down, and burying it costs two clicks
                every single appointment. */}
            {episode.visitNotes.slice(0, 1).map((note) => (
              <div key={note.id} className="mt-3 rounded-lg bg-surface-sunk p-3 text-sm">
                <div className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-faint">
                  Last visit · {formatDateIn(note.visitDate, tz, locale)}
                </div>
                {note.subjective && <p><span className="font-semibold">S:</span> {note.subjective}</p>}
                {note.objective && <p><span className="font-semibold">O:</span> {note.objective}</p>}
                {note.assessment && <p><span className="font-semibold">A:</span> {note.assessment}</p>}
                {note.plan && <p><span className="font-semibold">P:</span> {note.plan}</p>}
              </div>
            ))}

            {episode.visitNotes.length > 1 && (
              <details className="mt-2">
                <summary className="cursor-pointer text-sm font-semibold text-brand">
                  Earlier visits ({episode.visitNotes.length - 1})
                </summary>
                <ul className="mt-2 space-y-2">
                  {episode.visitNotes.slice(1).map((note) => (
                    <li key={note.id} className="rounded-lg bg-surface-sunk p-3 text-sm">
                      <div className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-faint">
                        {formatDateIn(note.visitDate, tz, locale)}
                      </div>
                      {note.subjective && <p><span className="font-semibold">S:</span> {note.subjective}</p>}
                      {note.objective && <p><span className="font-semibold">O:</span> {note.objective}</p>}
                      {note.assessment && <p><span className="font-semibold">A:</span> {note.assessment}</p>}
                      {note.plan && <p><span className="font-semibold">P:</span> {note.plan}</p>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        ))}

        {patient.episodes.length === 0 && (
          <p className="card p-6 text-center text-sm text-ink-soft">
            No episodes of care recorded yet.
          </p>
        )}
      </div>

      <aside className="space-y-5">
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-faint">
            Discharge summary
          </h2>
          <form action={startDocument} className="space-y-2">
            <input type="hidden" name="patientId" value={patient.id} />
            <input type="hidden" name="episodeId" value={activeEpisode?.id ?? ""} />
            <div>
              <label className="field-label" htmlFor="sourceDocumentId">
                Start from
              </label>
              <select id="sourceDocumentId" name="sourceDocumentId" className="select">
                <option value="">A blank template</option>
                {reusable.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.patient.fullName} — {doc.documentNo ?? "draft"}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-ink-faint">
                Copying a previous summary carries the structure across. The other
                patient&apos;s diagnosis, findings and measures are left out.
              </p>
            </div>
            <button type="submit" className="btn btn-primary w-full">
              New discharge summary
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-faint">
            Documents
          </h2>
          {patient.documents.length === 0 ? (
            <p className="card p-3 text-sm text-ink-faint">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {patient.documents.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/console/documents/${doc.id}`} className="card block p-3 hover:border-brand">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{doc.title}</span>
                      <span
                        className={`pill ${
                          doc.status === "DRAFT"
                            ? "bg-warn-soft text-warn"
                            : doc.status === "SUPERSEDED"
                              ? "bg-surface-sunk text-ink-faint"
                              : "bg-good-soft text-good"
                        }`}
                      >
                        {doc.status}
                      </span>
                    </div>
                    <div className="text-xs text-ink-faint">
                      {doc.documentNo ?? "Not yet numbered"} ·{" "}
                      {formatDateTimeIn(doc.finalisedAt ?? doc.createdAt, tz, locale)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {patient.packages.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-faint">
              Session packages
            </h2>
            {patient.packages.map((pack) => (
              <div key={pack.id} className="card p-3">
                <div className="text-sm font-semibold">{pack.name}</div>
                <div className="mt-1 text-xs text-ink-faint">
                  {pack.sessionsUsed} of {pack.sessionsTotal} used ·{" "}
                  {formatMinor(pack.priceMinor, session.clinicCurrency, locale)}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-sunk">
                  <div
                    className="h-full bg-brand"
                    style={{ width: `${(pack.sessionsUsed / pack.sessionsTotal) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </section>
        )}

        {outstanding > 0 && (
          <section className="card border-warn bg-warn-soft p-3">
            <div className="text-sm font-semibold text-warn">
              {formatMinor(outstanding, session.clinicCurrency, locale)} outstanding
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
