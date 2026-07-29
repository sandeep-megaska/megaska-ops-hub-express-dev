import { NextRequest, NextResponse } from "next/server";
import { withCors, handleOptions } from "../../_lib/cors";
import { hashSessionToken } from "../../../../services/auth/session";
import { prisma } from "../../../../services/db/prisma";
import { getOrCreateWalletAccount, parseAmountToMinorUnits } from "../../../../services/wallet";
import { createWalletReservation } from "../../../../services/wallet-reservation";
import { resolveCartId } from "../../../../services/shopify/storefront";

export async function OPTIONS(req: NextRequest) {
  const response = handleOptions(req);
  response.headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  return response;
}

export async function POST(req: NextRequest) {
  let customerProfileId = "";
  try {
    const authHeader = req.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const queryToken = req.nextUrl.searchParams.get("token")?.trim() ?? "";
    const sessionToken = bearerToken || queryToken;
    const body = (await req.json().catch(() => ({}))) as {
      cartId?: string;
      cartToken?: string;
      walletAmount?: number | string;
      sourceFlow?: "CHECKOUT" | "BUY_NOW";
    };
    const requestedAmountMinor = parseAmountToMinorUnits(body.walletAmount || "");
    const cartId = resolveCartId({ cartId: body.cartId, cartToken: body.cartToken });

    console.log("[WALLET APPLY] start", {
      hasAuthorizationHeader: Boolean(authHeader),
      hasBearerToken: Boolean(bearerToken),
      customerProfileId: customerProfileId || null,
      requestedAmountMinor,
      cartTokenPresent: Boolean(String(body.cartToken || "").trim()),
    });

    if (!sessionToken) {
      console.error("[WALLET APPLY] failed", {
        customerProfileId: customerProfileId || null,
        error: "Session token required",
      });
      return withCors(req, NextResponse.json({ ok: false, error: "Session token required" }, { status: 401 }));
    }

    const now = new Date();
    const session = await prisma.authSession.findFirst({
      where: {
        sessionTokenHash: hashSessionToken(sessionToken),
        revokedAt: null,
        expiresAt: { gt: now },
      },
      include: {
        customer: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!session?.customer) {
      console.error("[WALLET APPLY] failed", {
        customerProfileId: customerProfileId || null,
        error: "Invalid or expired session",
      });
      return withCors(req, NextResponse.json({ ok: false, error: "Invalid or expired session" }, { status: 401 }));
    }
    customerProfileId = session.customer.id;

    // Tenant scope: the wallet always belongs to the customer's own shop.
    const shopId = String(session.customer.shopId || "").trim();
    if (!shopId) {
      console.error("[WALLET APPLY] failed", { customerProfileId, error: "Customer has no shop context" });
      return withCors(req, NextResponse.json({ ok: false, error: "Customer shop context not found" }, { status: 400 }));
    }

    if (!cartId) {
      console.error("[WALLET APPLY] failed", {
        customerProfileId,
        error: "cartId/cartToken required",
      });
      return withCors(req, NextResponse.json({ ok: false, error: "cartId/cartToken required" }, { status: 400 }));
    }

    if (requestedAmountMinor <= 0) {
      console.error("[WALLET APPLY] failed", {
        customerProfileId,
        error: "walletAmount must be greater than 0",
      });
      return withCors(req, NextResponse.json({ ok: false, error: "walletAmount must be greater than 0" }, { status: 400 }));
    }

    const walletAccount = await getOrCreateWalletAccount(customerProfileId, "INR", { shopId });
    const activeReservations = await prisma.$queryRaw<Array<{ activeCount: number; total: number }>>`
      SELECT COUNT(*)::int AS "activeCount", COALESCE(SUM("reservedAmount"), 0)::int AS total
      FROM "WalletReservation"
      WHERE "walletAccountId" = ${walletAccount.id}
        AND "currency" = 'INR'
        AND "status" = 'ACTIVE'::"WalletReservationStatus"
        AND "expiresAt" > NOW()
    `;
    const reservedAmountMinor = Number(activeReservations[0]?.total || 0);
    const availableBalanceMinor = Math.max(
      0,
      Number(walletAccount.currentBalance || 0) - reservedAmountMinor
    );
    const approvedAmountMinor = Math.min(requestedAmountMinor, availableBalanceMinor);

    console.log("[WALLET APPLY] eligibility", {
      customerProfileId,
      availableBalanceMinor,
      requestedAmountMinor,
      approvedAmountMinor,
    });

    if (approvedAmountMinor <= 0) {
      console.error("[WALLET APPLY] failed", {
        customerProfileId,
        error: "Insufficient available wallet balance",
      });
      return withCors(
        req,
        NextResponse.json({ ok: false, error: "Insufficient available wallet balance" }, { status: 400 })
      );
    }

    console.log("[WALLET APPLY] creating reservation", {
      customerProfileId,
      approvedAmountMinor,
    });

    const reservation = await createWalletReservation({
      shopId,
      customerProfileId,
      cartId,
      amountMinor: approvedAmountMinor,
      sourceFlow: body.sourceFlow || "CHECKOUT",
      sessionReference: session.id,
    });

    const amountMinor = reservation.amountMinor;
    const amount = Number((amountMinor / 100).toFixed(2));

    console.log("[WALLET APPLY] success", {
      customerProfileId,
      reservationId: reservation.reservationId,
      code: reservation.discountCode,
      discountNodeId: reservation.discountNodeId,
    });
    console.log("[WALLET APPLY] outcome snapshot", {
      customerProfileId,
      reservationId: reservation.reservationId,
      code: reservation.discountCode,
      discountNodeId: reservation.discountNodeId,
      ok: true,
    });

    return withCors(
      req,
      NextResponse.json({
        ok: true,
        reservationId: reservation.reservationId,
        code: reservation.discountCode,
        discountNodeId: reservation.discountNodeId,
        amountMinor,
        amount,
        currency: reservation.currency,
      })
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Failed";
    console.error("[WALLET APPLY] failed", {
      customerProfileId: customerProfileId || null,
      error: errorMessage,
    });
    return withCors(
      req,
      NextResponse.json({ ok: false, error: errorMessage }, { status: 500 })
    );
  }
}
