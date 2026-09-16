import { redirect } from "next/navigation";
import { getStaffSession } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — ClinicDesk" };

export default async function LoginPage() {
  if (await getStaffSession()) redirect("/console");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <p className="text-xs font-bold uppercase tracking-widest text-brand">ClinicDesk</p>
      <h1 className="mt-2 mb-6 text-2xl font-bold">Practitioner sign in</h1>
      <LoginForm />
      <p className="mt-6 text-xs text-ink-faint">
        This console holds patient records. Every record you open is logged.
      </p>
    </main>
  );
}
