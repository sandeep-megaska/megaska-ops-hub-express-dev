import type { NextApiRequest, NextApiResponse } from "next";

// lib
import { prisma } from "../../../../lib/prisma";
import { syncCustomersForShop } from "../../../../lib/customer-sync";

// shopify services
import { getShopifyAdminForRequest } from "../../../../services/shopify/admin";
import { resolveShopFromRequest } from "../../../../services/shopify/shop-resolver";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed",
    });
  }

  try {
    /**
     * 1) Resolve current shop from the embedded admin request
     *    This must identify the current Shopify store safely.
     */
    const resolvedShop = await resolveShopFromRequest(req);

    if (!resolvedShop?.shopDomain) {
      return res.status(401).json({
        success: false,
        error: "Unable to resolve current shop",
      });
    }

    /**
     * 2) Get authenticated Shopify Admin client for THIS shop
     */
    const admin = await getShopifyAdminForRequest(req, resolvedShop.shopDomain);

    if (!admin) {
      return res.status(401).json({
        success: false,
        error: "Unable to create Shopify admin client",
      });
    }

    /**
     * 3) Resolve local Shop row
     */
    const shop = await prisma.shop.findUnique({
      where: {
        shopDomain: resolvedShop.shopDomain,
      },
      select: {
        id: true,
        shopDomain: true,
        isActive: true,
      },
    });

    if (!shop || !shop.isActive) {
      return res.status(404).json({
        success: false,
        error: "Shop not found or inactive",
      });
    }

    /**
     * 4) Run per-shop sync
     */
    const result = await syncCustomersForShop({
      shopId: shop.id,
      admin,
      defaultCountry: "IN",
    });

    return res.status(200).json({
      success: true,
      shopDomain: shop.shopDomain,
      ...result,
    });
  } catch (error: any) {
    console.error("Customer sync failed:", error);

    return res.status(500).json({
      success: false,
      error: error?.message || "Customer sync failed",
    });
  }
}
