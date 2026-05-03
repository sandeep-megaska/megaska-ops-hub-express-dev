import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";

const GONE_MESSAGE =
  "Deprecated exchange API. Use /api/account/exchange-requests for shop-scoped exchange requests.";

export const runtime = "nodejs";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  return withCors(req, NextResponse.json({ error: GONE_MESSAGE }, { status: 410 }));
}

export async function GET(req: NextRequest) {
  return withCors(req, NextResponse.json({ error: GONE_MESSAGE }, { status: 410 }));
}
