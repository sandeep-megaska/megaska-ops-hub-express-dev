import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../../../_lib/cors";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Retired: LoopD2C doesn't collect bank or UPI details. Refunds go back through
// Shopify; a store that needs other details contacts the customer itself.
export async function POST(req: NextRequest) {
  return withCors(req, NextResponse.json({ error: "Refund details aren't collected here. The store will contact you if anything is needed." }, { status: 410 }));
}
