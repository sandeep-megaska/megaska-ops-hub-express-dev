import { NextRequest } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { verifyAdminMediaQuery } from "../../../../../services/shopify/admin-request-auth";
import { getShopByDomain } from "../../../../../services/shopify/shop";
import { fetchInboxMedia } from "../../../../../services/whatsapp/inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Photos, voice notes and documents customers sent on WhatsApp. Meta media
// URLs need the shop's token, so they are proxied; only media that belongs to
// one of this shop's conversations is served. <img>/<audio> loads can't carry a
// session token, so the conversation page signs each URL for its verified shop.
export async function GET(request: NextRequest, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await params;
  const shopDomain = verifyAdminMediaQuery(mediaId, request.nextUrl.searchParams);
  if (!shopDomain) return new Response("Not found", { status: 404 });
  const shop = await getShopByDomain(shopDomain);
  if (!shop?.id || !shop.isActive || shop.uninstalledAt) return new Response("Not found", { status: 404 });
  const owned = await prisma.whatsAppMessage.findFirst({ where: { mediaId, conversation: { shopId: shop.id } }, select: { id: true } });
  if (!owned) return new Response("Not found", { status: 404 });
  const media = await fetchInboxMedia({ shopId: shop.id, mediaId });
  if (!media) return new Response("Media unavailable", { status: 502 });
  return new Response(media.body, { headers: { "Content-Type": media.contentType, "Cache-Control": "private, max-age=3600" } });
}
