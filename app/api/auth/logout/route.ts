import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { hashSessionToken } from "../../../../services/auth/session";
import { withCors, handleOptions } from "../../_lib/cors";
import {
  ShopResolutionError,
  requireShopFromRequest,
} from "../../../../services/shopify/shop";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  try {
    const shop = await requireShopFromRequest(req);

    const body = await req.json().catch(() => ({}));
    const bodyToken = String(body?.token ?? "").trim();

    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";

    const sessionToken = bearerToken || bodyToken;

    if (!sessionToken) {
      return withCors(
        req,
        NextResponse.json(
          { success: false, error: "Session token required" },
          { status: 400 }
        )
      );
    }

    const sessionTokenHash = hashSessionToken(sessionToken);

    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash,
        revokedAt: null,
        customer: {
          shopId: shop.id,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!session) {
      return withCors(
        req,
        NextResponse.json({
          success: true,
          revoked: false,
        })
      );
    }

    await prisma.authSession.update({
      where: {
        id: session.id,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return withCors(
      req,
      NextResponse.json({
        success: true,
        revoked: true,
      })
    );
  } catch (error) {
    console.error("[AUTH LOGOUT ERROR]", error);

    const status =
      error instanceof ShopResolutionError ? error.status : 500;

    return withCors(
      req,
      NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Internal error",
        },
        { status }
      )
    );
  }
}
