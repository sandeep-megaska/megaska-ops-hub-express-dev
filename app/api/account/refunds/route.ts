import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../_lib/cors";
import { getAuthenticatedExchangeCustomer } from "../../../../services/exchange/auth";
import { listCustomerRefunds } from "../../../../services/refund/customer-refunds";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedExchangeCustomer(req);
  if (!auth) {
    return withCors(req, NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
  }

  const data = await listCustomerRefunds(auth);
  return withCors(req, NextResponse.json({ items: data }));
}
