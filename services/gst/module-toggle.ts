import { prisma } from "../db/prisma";

// Per-shop on/off for this app's GST invoicing, stored in the shared
// ShopModuleConfig table (moduleKey = "gst"). A merchant who runs another GST
// app (e.g. GST Pro) turns ours off so only one engine numbers their orders.
//
// Default is ENABLED (no config row) to match requireEnabledModule() semantics
// used by the app proxy — a missing row means "not explicitly disabled".
export const GST_MODULE_KEY = "gst";

export async function isGstModuleEnabled(shopId: string): Promise<boolean> {
  const cleanShopId = String(shopId || "").trim();
  if (!cleanShopId) return false;
  const config = await prisma.shopModuleConfig.findUnique({
    where: { shopId_moduleKey: { shopId: cleanShopId, moduleKey: GST_MODULE_KEY } },
    select: { enabled: true },
  });
  return config ? config.enabled : true;
}

export async function setGstModuleEnabled(shopId: string, enabled: boolean): Promise<void> {
  const cleanShopId = String(shopId || "").trim();
  if (!cleanShopId) throw new Error("shopId is required to toggle the GST module");
  await prisma.shopModuleConfig.upsert({
    where: { shopId_moduleKey: { shopId: cleanShopId, moduleKey: GST_MODULE_KEY } },
    create: { shopId: cleanShopId, moduleKey: GST_MODULE_KEY, enabled },
    update: { enabled },
  });
}
