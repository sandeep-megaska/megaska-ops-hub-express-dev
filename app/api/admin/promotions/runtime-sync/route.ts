import { NextRequest, NextResponse } from "next/server";
import { resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context.ts";
import { syncPromotionRuntime, RuntimeSyncError, type RuntimeSyncAuth } from "../../../../../services/promotions/runtime-sync.server.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION = "promotions.manage";

function permissions(req: NextRequest) {
  return String(req.headers.get("x-loopdesk-admin-permissions") || "")
    .split(/[ ,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function actorId(req: NextRequest) {
  return String(req.headers.get("x-loopdesk-admin-actor-id") || "").trim();
}

async function authenticate(req: NextRequest): Promise<RuntimeSyncAuth> {
  const resolved = await resolveAdminShopFromRequest(req);
  if (!resolved.shop?.id) throw new RuntimeSyncError("UNAUTHENTICATED", "Authenticated embedded-admin shop session required.");
  const actor = actorId(req);
  if (!actor) throw new RuntimeSyncError("UNAUTHENTICATED", "Authenticated embedded-admin actor session required.");
  const granted = permissions(req);
  if (!granted.includes(PERMISSION)) throw new RuntimeSyncError("UNAUTHORIZED", "Actor is not allowed to manage promotions.");
  return { shopId: resolved.shop.id, shopDomain: resolved.shop.shopDomain, actorId: actor, permissions: granted };
}

function status(code: string) {
  if (code === "UNAUTHENTICATED") return 401;
  if (code === "UNAUTHORIZED") return 403;
  if (code === "SYNC_IN_PROGRESS") return 409;
  return 400;
}

export async function POST(req: NextRequest) {
  try {
    // Body shopId/actorId are intentionally ignored. Embedded-admin session is authoritative.
    await req.json().catch(() => null);
    const auth = await authenticate(req);
    const result = await syncPromotionRuntime(auth);
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof RuntimeSyncError ? error.code : "RUNTIME_SYNC_FAILED";
    const message = error instanceof Error ? error.message : "Promotion runtime synchronization failed.";
    return NextResponse.json({ ok: false, error: message, code }, { status: status(code), headers: { "Cache-Control": "no-store" } });
  }
}
