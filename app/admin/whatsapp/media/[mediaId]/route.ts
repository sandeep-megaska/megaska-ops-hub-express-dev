import { NextRequest } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { resolveAdminShopFromSearchParams } from "../../../../../services/shopify/admin-shop-context";
import { fetchInboxMedia } from "../../../../../services/whatsapp/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Photos, voice notes and documents customers sent on WhatsApp. Meta media
// URLs need the shop's token, so they are proxied; only media that belongs to
// one of this shop's conversations is served.
export async function GET(request: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const resolved = await resolveAdminShopFromSearchParams(Object.fromEntries(request.nextUrl.searchParams));
  if (!resolved.shop?.id) return new Response("Not found", { status: 404 });
  const owned = await prisma.whatsAppMessage.findFirst({ where: { mediaId, conversation: { shopId: resolved.shop.id } }, select: { id: true } });
  if (!owned) return new Response("Not found", { status: 404 });
  const media = await fetchInboxMedia({ shopId: resolved.shop.id, mediaId });
  if (!media) return new Response("Media unavailable", { status: 502 });
  return new Response(media.body, { headers: { "Content-Type": media.contentType, "Cache-Control": "private, max-age=3600" } });
}
