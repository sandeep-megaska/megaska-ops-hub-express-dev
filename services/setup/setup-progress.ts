// Setup progress for the LoopD2C home page: the steps a new merchant (or an App
// Store reviewer) needs before the app does useful work, each checked from saved
// settings. Read-only. A check that fails to load counts as not done, so the page
// still renders. The theme app embed can't be detected from the server and is
// offered as a link instead of a counted step.
import { prisma } from "../db/prisma";
import { LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } from "../loopdesk/merchant-settings";
import { getDelhiveryAdminConfig } from "../delhivery/config";
import { getActiveGstSettings } from "../gst/settings";

export type SetupStep = { id: string; label: string; done: boolean; href: string };
export type SetupProgress = { steps: SetupStep[]; completed: number; total: number; next: SetupStep | null };

type Checks = {
  planApproved: (shopId: string) => Promise<boolean>;
  branding: (shopId: string) => Promise<boolean>;
  checkoutSettings: (shopId: string) => Promise<boolean>;
  delhivery: (shopId: string) => Promise<boolean>;
  gst: (shopId: string) => Promise<boolean>;
};

const defaultChecks: Checks = {
  async planApproved(shopId) {
    const sub = await prisma.merchantSubscription.findUnique({ where: { shopId }, select: { status: true, externalSubscriptionReference: true } });
    return Boolean(sub && ["ACTIVE", "PAST_DUE"].includes(sub.status) && sub.externalSubscriptionReference);
  },
  // Defaults fill in a name and colour, so "done" means the merchant has saved
  // Merchant Settings at least once.
  async branding(shopId) {
    const row = await prisma.shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: LOOPDESK_RUNTIME_CONFIG_MODULE_KEY } }, select: { id: true } });
    return Boolean(row);
  },
  async checkoutSettings(shopId) {
    const row = await prisma.shopModuleConfig.findUnique({ where: { shopId_moduleKey: { shopId, moduleKey: "express_checkout_settings" } }, select: { id: true } });
    return Boolean(row);
  },
  async delhivery(shopId) {
    const config = await getDelhiveryAdminConfig(shopId);
    return Boolean(config.enabled && config.hasApiToken && config.pickupLocation && config.originPincode);
  },
  async gst(shopId) {
    const result = await getActiveGstSettings({ shopId });
    return Boolean(result.ok && result.data?.gstin && result.data?.legalName);
  },
};

const STEPS: Array<{ id: keyof Checks; label: string; href: string }> = [
  { id: "planApproved", label: "Choose your plan", href: "/admin/billing" },
  { id: "branding", label: "Add your brand", href: "/admin/merchant-settings#branding" },
  { id: "checkoutSettings", label: "Set prepaid offer & COD", href: "/admin/checkout" },
  { id: "delhivery", label: "Connect Delhivery", href: "/admin/merchant-settings#delhivery" },
  { id: "gst", label: "Enter GST details", href: "/admin/gst/settings" },
];

export async function getSetupProgress(shopId: string, checks: Checks = defaultChecks): Promise<SetupProgress> {
  const results = await Promise.all(STEPS.map((step) => checks[step.id](shopId).catch(() => false)));
  const steps = STEPS.map((step, index) => ({ id: step.id, label: step.label, href: step.href, done: results[index] }));
  const completed = steps.filter((step) => step.done).length;
  return { steps, completed, total: steps.length, next: steps.find((step) => !step.done) ?? null };
}
