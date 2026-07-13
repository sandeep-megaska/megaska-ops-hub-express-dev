import type { DashboardStatusDto, DashboardStatusTone } from "./contract.ts";
function norm(v: unknown) { const s = String(v ?? "").trim().toUpperCase().replace(/[\s-]+/g, "_"); return s || "UNKNOWN"; }
function title(code: string) { if (code === "UNKNOWN") return "Unknown"; return code.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()); }
function dto(raw: unknown, tones: Record<string, DashboardStatusTone>): DashboardStatusDto { const code = norm(raw); return { code, label: title(code), tone: tones[code] || "NEUTRAL" }; }
export function buildFinancialStatusDto(raw: unknown): DashboardStatusDto { return dto(raw, { PAID: "SUCCESS", PARTIALLY_PAID: "WARNING", PENDING: "WARNING", AUTHORIZED: "INFO", REFUNDED: "INFO", PARTIALLY_REFUNDED: "INFO", VOIDED: "DANGER" }); }
export function buildFulfillmentStatusDto(raw: unknown): DashboardStatusDto { return dto(raw, { FULFILLED: "SUCCESS", DELIVERED: "SUCCESS", SUCCESS: "SUCCESS", SHIPPED: "INFO", IN_TRANSIT: "INFO", OUT_FOR_DELIVERY: "INFO", PARTIAL: "WARNING", PARTIALLY_FULFILLED: "WARNING", UNFULFILLED: "WARNING", RESTOCKED: "DANGER" }); }
