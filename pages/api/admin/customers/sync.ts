import type { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { syncCustomersForShop } from "../../../lib/customer-sync";

// Replace this with your actual Shopify admin authentication helper.
import { authenticateAdminRequest } from "../../../lib/shopify-auth";

const prisma = new PrismaClient();

export default async function handler(req: Request, res: Response) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    /**
     * Must return:
     * - shop domain (e.g. bigonbuy-fashions.myshopify.com)
     * - authenticated admin GraphQL client for THIS shop only
     */
    const { shopDomain, admin } = await authenticateAdminRequest(req, res);

    if (!shopDomain || !admin) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true, shopDomain: true, isActive: true },
    });

    if (!shop || !shop.isActive) {
      return res.status(404).json({ success: false, error: "Shop not found or inactive" });
    }

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
