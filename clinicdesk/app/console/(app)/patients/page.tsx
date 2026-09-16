import Link from "next/link";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";

export const metadata = { title: "Patients — ClinicDesk" };

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);

  const query = q?.trim();
  const patients = await db.patient.findMany({
    where: {
      archivedAt: null,
      ...(query
        ? {
            OR: [
              { fullName: { contains: query, mode: "insensitive" as const } },
              { patientNo: { contains: query, mode: "insensitive" as const } },
              { phoneE164: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 60,
    select: {
      id: true,
      fullName: true,
      patientNo: true,
      phoneE164: true,
      city: true,
      _count: { select: { episodes: true, appointments: true } },
    },
  });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Patients</h1>
        <form className="ml-auto flex gap-2">
          <input
            name="q"
            defaultValue={query}
            className="input h-10 w-56"
            placeholder="Name, ID or phone"
            aria-label="Search patients"
          />
          <button type="submit" className="btn btn-secondary h-10 min-h-0">
            Search
          </button>
        </form>
      </div>

      {patients.length === 0 ? (
        <p className="card p-6 text-center text-sm text-ink-soft">
          {query ? `No patients match “${query}”.` : "No patients yet."}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-[10px] border border-line bg-surface">
          {patients.map((patient) => (
            <li key={patient.id}>
              <Link
                href={`/console/patients/${patient.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-surface-sunk"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{patient.fullName}</div>
                  <div className="text-xs text-ink-faint">
                    {patient.patientNo}
                    {patient.phoneE164 && ` · ${patient.phoneE164}`}
                    {patient.city && ` · ${patient.city}`}
                  </div>
                </div>
                <div className="text-right text-xs text-ink-faint">
                  {patient._count.episodes} episode{patient._count.episodes === 1 ? "" : "s"}
                  <br />
                  {patient._count.appointments} visit{patient._count.appointments === 1 ? "" : "s"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
