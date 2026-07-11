import { NextResponse } from "next/server";
import { synchronizePromotionFunctionConfiguration } from "../../../../../services/promotions/runtime/synchronization.server.ts";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { shopId?: string; actorId?: string | null } | null;
  if (!body?.shopId) return NextResponse.json({ ok: false, code: "BAD_REQUEST", message: "shopId is required.", retryable: false }, { status: 400 });
  const result = await synchronizePromotionFunctionConfiguration({ shopId: body.shopId, actorId: body.actorId ?? null });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
