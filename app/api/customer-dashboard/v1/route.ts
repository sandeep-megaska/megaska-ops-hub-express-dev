import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { resolveCustomerDashboardContext, getCustomerDashboardV1, toCustomerDashboardErrorDto, CustomerDashboardError, validateCustomerDashboardV1 } from "../../../../services/customer-dashboard";
export const runtime = "nodejs";
export async function OPTIONS(req: NextRequest) { return secure(withCors(req, handleOptions(req))); }
function secure(res: NextResponse) { res.headers.set("Cache-Control", "private, no-store"); res.headers.set("Vary", "Origin, Authorization, Access-Control-Request-Headers"); res.headers.set("X-Content-Type-Options", "nosniff"); return res; }
export async function GET(req: NextRequest) {
  try { const context = await resolveCustomerDashboardContext(req); const dashboard = await getCustomerDashboardV1(context); validateCustomerDashboardV1(dashboard); const res = NextResponse.json(dashboard, { status: 200 }); return secure(withCors(req, res)); }
  catch (error) { const normalized = error instanceof CustomerDashboardError ? error : new CustomerDashboardError({ code: "DASHBOARD_UNAVAILABLE", message: "We could not load your dashboard right now. Please try again.", status: 503, retryable: true, cause: error }); console.error("customer_dashboard_v1_route_error", { errorCode: normalized.code }); const res = NextResponse.json(toCustomerDashboardErrorDto(normalized), { status: normalized.status }); return secure(withCors(req, res)); }
}
