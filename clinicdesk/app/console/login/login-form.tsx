"use client";

import { useActionState } from "react";
import { checkCode, sendCode, type LoginState } from "./actions";

/**
 * Email + one-time code. No passwords to leak, reset or share between the
 * practitioner and her front desk.
 */
export function LoginForm() {
  const [emailState, submitEmail, sendingEmail] = useActionState<LoginState, FormData>(sendCode, {
    stage: "email",
  });
  const [codeState, submitCode, checkingCode] = useActionState<LoginState, FormData>(
    checkCode,
    emailState,
  );

  const stage = codeState.stage === "code" || emailState.stage === "code" ? "code" : "email";
  const email = codeState.email ?? emailState.email ?? "";
  const error = codeState.error ?? emailState.error;

  return (
    <div className="card p-5">
      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {stage === "email" ? (
        <form action={submitEmail} className="space-y-3">
          <div>
            <label className="field-label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="input"
              required
              autoComplete="email"
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={sendingEmail}>
            {sendingEmail ? "Sending…" : "Send sign-in code"}
          </button>
        </form>
      ) : (
        <form action={submitCode} className="space-y-3">
          <p className="text-sm text-ink-soft">
            We sent a 6-digit code to <span className="font-semibold text-ink">{email}</span>.
          </p>
          <input type="hidden" name="email" value={email} />
          <div>
            <label className="field-label" htmlFor="code">
              Sign-in code
            </label>
            <input
              id="code"
              name="code"
              className="input text-center text-xl tracking-[0.4em]"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={checkingCode}>
            {checkingCode ? "Checking…" : "Sign in"}
          </button>
        </form>
      )}
    </div>
  );
}
