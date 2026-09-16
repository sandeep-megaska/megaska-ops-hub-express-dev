import Link from "next/link";
import { clinicScope } from "@/lib/db";
import { requireStaff } from "@/lib/session";
import { formatMinor, revenueSummary } from "@/services/billing/bills";
import { fiscalYear } from "@/lib/ids";
import { formatDateIn } from "@/services/scheduling/timezone";

export const metadata = { title: "Billing — ClinicDesk" };

/**
 * Receipts, not tax invoices.
 *
 * Healthcare services are GST-exempt and this clinic is unregistered, so there
 * is no tax column anywhere on this screen by design. The financial-year total
 * is the number her CA asks for, which she currently rebuilds from a receipt
 * book by hand.
 */
export default async function BillingPage() {
  const session = await requireStaff();
  const db = clinicScope(session.clinicId);
  const { clinicCurrency: currency, clinicLocale: locale, clinicTimezone: tz } = session;

  const fy = fiscalYear(new Date(), tz);
  const fyStartYear = Number(fy.split("-")[0]);
  const from = new Date(Date.UTC(fyStartYear, 3, 1) - 330 * 60_000);
  const to = new Date();

  const [summary, bills, outstanding] = await Promise.all([
    revenueSummary({ clinicId: session.clinicId, from, to }),
    db.bill.findMany({
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { patient: { select: { id: true, fullName: true, patientNo: true } } },
    }),
    db.bill.findMany({
      where: { status: { in: ["ISSUED", "PART_PAID"] } },
      select: { totalMinor: true, paidMinor: true },
    }),
  ]);

  const outstandingMinor = outstanding.reduce(
    (sum, bill) => sum + Math.max(0, bill.totalMinor - bill.paidMinor),
    0,
  );

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">Billing</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-faint">
            Received · FY {fy}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {formatMinor(summary.totalMinor, currency, locale)}
          </div>
          <div className="text-xs text-ink-faint">{summary.count} payments</div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-faint">
            Outstanding
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {formatMinor(outstandingMinor, currency, locale)}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-ink-faint">By mode</div>
          <ul className="mt-1 space-y-0.5 text-sm">
            {summary.byMode.length === 0 && <li className="text-ink-faint">No payments yet.</li>}
            {summary.byMode.map((entry) => (
              <li key={entry.mode} className="flex justify-between">
                <span className="text-ink-soft">{entry.mode.replace("_", " ")}</span>
                <span className="tabular-nums">{formatMinor(entry.minor, currency, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-faint">
          Recent receipts
        </h2>
        {bills.length === 0 ? (
          <p className="card p-6 text-center text-sm text-ink-soft">No receipts yet.</p>
        ) : (
          <table className="w-full overflow-hidden rounded-[10px] border border-line bg-surface text-sm">
            <thead className="bg-surface-sunk text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-3 py-2 text-left font-bold">Receipt</th>
                <th className="px-3 py-2 text-left font-bold">Patient</th>
                <th className="px-3 py-2 text-left font-bold">Date</th>
                <th className="px-3 py-2 text-right font-bold">Total</th>
                <th className="px-3 py-2 text-right font-bold">Paid</th>
                <th className="px-3 py-2 text-left font-bold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td className="px-3 py-2 font-mono text-xs">{bill.billNo ?? "—"}</td>
                  <td className="px-3 py-2">
                    <Link href={`/console/patients/${bill.patient.id}`} className="hover:text-brand">
                      {bill.patient.fullName}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-soft">
                    {formatDateIn(bill.issuedAt ?? bill.createdAt, tz, locale)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatMinor(bill.totalMinor, currency, locale)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                    {formatMinor(bill.paidMinor, currency, locale)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`pill ${
                        bill.status === "PAID"
                          ? "bg-good-soft text-good"
                          : bill.status === "PART_PAID"
                            ? "bg-warn-soft text-warn"
                            : "bg-surface-sunk text-ink-faint"
                      }`}
                    >
                      {bill.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
