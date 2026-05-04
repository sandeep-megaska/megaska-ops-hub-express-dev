import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../../../services/exchange/auth";
import { submitCustomerPayoutDetails } from "../../../../../../services/refund/customer-refunds";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedExchangeCustomer(req);
  if (!auth) {
    return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { id } = await context.params;
  const payload = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (!payload) {
    return withCors(req, NextResponse.json({ error: "Invalid payload" }, { status: 400 }));
  }

  const result = await submitCustomerPayoutDetails(auth, id, payload);
  if ("error" in result) {
    return withCors(req, NextResponse.json({ error: result.error }, { status: result.status }));
  }

  return withCors(req, NextResponse.json(result.data));
}
