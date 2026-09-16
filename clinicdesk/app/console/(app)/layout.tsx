import Link from "next/link";
import { requireStaff, signOut } from "@/lib/session";

const NAV = [
  { href: "/console", label: "Today" },
  { href: "/console/patients", label: "Patients" },
  { href: "/console/billing", label: "Billing" },
];

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();

  async function handleSignOut() {
    "use server";
    await signOut();
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
          <Link href="/console" className="text-sm font-bold text-brand">
            {session.clinicName}
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-2.5 py-1.5 font-medium text-ink-soft hover:bg-surface-sunk hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-ink-faint sm:inline">{session.fullName}</span>
            <form action={handleSignOut}>
              <button type="submit" className="btn btn-ghost h-8 min-h-0 px-2 text-xs">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-4 py-6">{children}</div>
    </div>
  );
}
