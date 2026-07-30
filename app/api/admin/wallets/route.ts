import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { ShopResolutionError } from "../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../services/shopify/admin-auth";

export async function GET(req: NextRequest) {
  try {
    const shop = await requireAdminShopFromRequest(req);

    const q = String(req.nextUrl.searchParams.get("q") || "").trim();

    const wallets = await prisma.$queryRaw<
      Array<{
        id: string;
        customerProfileId: string;
        currency: string;
        currentBalance: number;
        updatedAt: Date;
        phoneE164: string;
        email: string | null;
        firstName: string | null;
        lastName: string | null;
        fullName: string | null;
      }>
    >`
      SELECT wa."id", wa."customerProfileId", wa."currency", wa."currentBalance", wa."updatedAt",
        cp."phoneE164", cp."email", cp."firstName", cp."lastName", cp."fullName"
      FROM "WalletAccount" wa
      JOIN "CustomerProfile" cp ON cp."id" = wa."customerProfileId"
      WHERE wa."currency" = 'INR'
        AND wa."shopId" = ${shop.id}
        AND (
          ${q} = ''
          OR cp."phoneE164" ILIKE ${`%${q}%`}
          OR COALESCE(cp."email", '') ILIKE ${`%${q}%`}
          OR COALESCE(cp."firstName", '') ILIKE ${`%${q}%`}
          OR COALESCE(cp."lastName", '') ILIKE ${`%${q}%`}
          OR COALESCE(cp."fullName", '') ILIKE ${`%${q}%`}
        )
      ORDER BY wa."updatedAt" DESC
      LIMIT 100
    `;

    return NextResponse.json({ wallets });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
