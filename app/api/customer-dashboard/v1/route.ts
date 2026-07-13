import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { resolveCustomerDashboardContext, getCustomerDashboardV1, toCustomerDashboardErrorDto, CustomerDashboardError } from "../../../../services/customer-dashboard";
export const runtime = "nodejs";
export async function OPTIONS(req: NextRequest) { return handleOptions(req); }
export async function GET(req: NextRequest) {
  try { const context = await resolveCustomerDashboardContext(req); const dashboard = await getCustomerDashboardV1(context); const res = NextResponse.json(dashboard, { status: 200 }); res.headers.set("Cache-Control", "private, no-store"); return withCors(req, res); }
  catch (error) { const normalized = error instanceof CustomerDashboardError ? error : new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard right now. Please try again.", status: 503, retryable: true, cause: error }); const res = NextResponse.json(toCustomerDashboardErrorDto(normalized), { status: normalized.status }); res.headers.set("Cache-Control", "private, no-store"); return withCors(req, res); }
}
