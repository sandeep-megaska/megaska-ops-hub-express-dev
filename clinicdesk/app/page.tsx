import Link from "next/link";

export default function PlatformHome() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-24">
      <p className="text-xs font-bold uppercase tracking-widest text-brand">ClinicDesk</p>
      <h1 className="mt-3 text-3xl font-bold text-ink">
        Booking, clinical records and billing for allied-health practices.
      </h1>
      <p className="mt-4 text-ink-soft leading-relaxed">
        Each clinic gets its own booking page, its own letterhead and its own records.
        Drop the booking widget into an existing website, or point a domain at us.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link className="btn btn-primary" href="/console">
          Practitioner sign in
        </Link>
        <Link className="btn btn-secondary" href="/book/heal">
          See a demo booking page
        </Link>
      </div>
    </main>
  );
}
