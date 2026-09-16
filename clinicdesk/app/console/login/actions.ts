"use server";

import { redirect } from "next/navigation";
import { requestLoginCode, verifyLoginCode } from "@/lib/session";

export type LoginState = { stage: "email" | "code"; email?: string; error?: string };

export async function sendCode(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email.includes("@")) return { stage: "email", error: "Enter a valid email address." };
  await requestLoginCode(email);
  return { stage: "code", email };
}

export async function checkCode(prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? prev.email ?? "");
  const code = String(formData.get("code") ?? "");
  const result = await verifyLoginCode(email, code);
  if (!result.ok) return { stage: "code", email, error: result.error };
  redirect("/console");
}
