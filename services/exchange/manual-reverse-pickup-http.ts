import { NextResponse } from "next/server";
import { ManualPickupError } from "./manual-reverse-pickup";
import { ShopResolutionError } from "../shopify/shop";
import type { PickupAddress } from "./manual-reverse-pickup-rules";

/** JSON error for the manual reverse-pickup admin routes. */
export function manualPickupErrorResponse(error: unknown, label: string) {
  if (error instanceof ManualPickupError) {
    return NextResponse.json({ error: error.message, code: error.code ?? null, details: error.details ?? null }, { status: error.status });
  }
  if (error instanceof ShopResolutionError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[MANUAL REVERSE PICKUP] ${label} failed`, { error: error instanceof Error ? error.message : String(error) });
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

const ADDRESS_KEYS: Array<keyof PickupAddress> = ["name", "phone", "address1", "address2", "city", "state", "pin", "country", "email"];

/** The team's address edits from a request body (strings only, bounded). */
export function addressFromBody(value: unknown): Partial<PickupAddress> | null {
  if (!value || typeof value !== "object") return null;
  const out: Partial<PickupAddress> = {};
  for (const key of ADDRESS_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "string" && raw.trim()) out[key] = raw.trim().slice(0, 250);
  }
  return Object.keys(out).length ? out : null;
}

export function noteFromBody(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
