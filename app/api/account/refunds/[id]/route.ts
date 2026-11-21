import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../../services/exchange/auth";
import { getCustomerRefundById } from "../../../../../services/refund/customer-refunds";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedExchangeCustomer(req);
  if (!auth) {
    return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const { id } = await context.params;
  const item = await getCustomerRefundById(auth, id);

  if (!item) {
    return withCors(req, NextResponse.json({ error: "Refund not found" }, { status: 404 }));
  }

  return withCors(req, NextResponse.json(item));
}
