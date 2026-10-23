import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "../../../../services/db/prisma";
import { syncCustomersForShop } from "../../../../lib/customer-sync";
import { verifyShopifySessionToken } from "../../../../services/shopify/session-token";

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
    // The shop comes only from the verified App Bridge session token (the admin
    // page's same-origin fetch carries it); never from ?shop=, headers or a default store.
    let verifiedShopDomain = "";
    try {
      verifiedShopDomain = verifyShopifySessionToken(String(req.headers.authorization || "")).shopDomain;
    } catch {
      verifiedShopDomain = "";
    }
    const shopConfig = { shopDomain: verifiedShopDomain };

    if (!shopConfig?.shopDomain) {
      return res.status(401).json({
        success: false,
        error: "Unable to resolve current shop",
      });
    }

    const shop = await prisma.shop.findUnique({
      where: {
        shopDomain: shopConfig.shopDomain,
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

    const result = await syncCustomersForShop({
      shopId: shop.id,
      shopDomain: shop.shopDomain,
      defaultCountry: "IN",
    });

    return res.status(200).json({
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
