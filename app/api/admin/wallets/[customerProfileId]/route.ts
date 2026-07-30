import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../../services/db/prisma";
import { getOrCreateWalletAccount, listWalletTransactions } from "../../../../../services/wallet";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";

export async function GET(req: NextRequest, context: { params: Promise<{ customerProfileId: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { customerProfileId } = await context.params;

    const customer = await prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
      select: {
        id: true,
        shopId: true,
        phoneE164: true,
        email: true,
        firstName: true,
        lastName: true,
        fullName: true,
      },
    });

    // Tenant isolation: only expose a customer that belongs to the acting shop.
    // A 404 (not 403) avoids leaking whether the id exists under another shop.
    if (!customer || customer.shopId !== shop.id) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const wallet = await getOrCreateWalletAccount(customerProfileId, "INR", { shopId: shop.id });
    const transactions = await listWalletTransactions(customerProfileId, "INR", 150, { shopId: shop.id });

    const { shopId: _shopId, ...customerPublic } = customer;
    return NextResponse.json({ customer: customerPublic, wallet, transactions });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
