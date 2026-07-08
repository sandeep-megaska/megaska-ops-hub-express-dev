import {
  getCartIntelligenceSettings,
  getLoopDeskMerchantSettings,
  getLoopDeskRuntimeConfig,
} from "../../../services/loopdesk/merchant-settings";
import { getDelhiveryAdminConfig } from "../../../services/delhivery/config";
import { getRazorpayAdminConfig } from "../../../services/razorpay/config";
import {
  getPromotionRulesConfig,
  promotionRulesSetupStatus,
} from "../../../services/promotion-rules/config";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromSearchParams,
} from "../../../services/shopify/admin-shop-context";
import { withEmbeddedContext } from "../promotion-rules/embedded-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    shop?: string;
    shopify_shop?: string;
    host?: string;
    hmac?: string;
    embedded?: string;
  }>;
};

type WizardStatus = "Complete" | "Incomplete" | "Needs attention";

const cardClass = "rounded-2xl border border-gray-200 bg-white p-6 shadow-sm";
const mutedClass = "text-sm leading-6 text-gray-600";

function envPresent(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

function statusClass(status: WizardStatus) {
  if (status === "Complete") return "border-green-200 bg-green-50 text-green-800";
  if (status === "Needs attention") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-gray-200 bg-gray-50 text-gray-700";
}

function StatusPill({ status }: { status: WizardStatus }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(status)}`}>
      {status}
    </span>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="inline-flex rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50" href={href}>
      {children}
    </a>
  );
}

function WizardStep({
  number,
  title,
  status,
  description,
  actions,
  details,
}: {
  number: number;
  title: string;
  status: WizardStatus;
  description: string;
  actions?: React.ReactNode;
  details?: React.ReactNode;
}) {
  return (
    <section className={`${cardClass} grid gap-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-950 text-sm font-semibold text-white">
            {number}
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-950">{title}</h2>
            <p className={`mt-1 ${mutedClass}`}>{description}</p>
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      {details ? <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-700">{details}</div> : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}

export default async function InstallationWizardPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const resolved = await resolveAdminShopFromSearchParams(params);

  if (!resolved.shop?.id) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className={cardClass}>
          <h1 className="text-2xl font-semibold text-gray-950">Installation Wizard</h1>
          <p className="mt-3 text-sm text-red-700">
            {formatAdminShopResolutionError(resolved)}
          </p>
          {resolved.shopDomain ? (
            <p className="mt-4 text-sm">
              <a className="font-medium text-blue-700 underline" href={`/api/auth/install?shop=${encodeURIComponent(resolved.shopDomain)}`}>
                Reinstall the Shopify app for {resolved.shopDomain}
              </a>
            </p>
          ) : null}
        </div>
      </main>
    );
  }

  const [settings, cartIntelligence, runtimeConfig, delhivery, razorpay, promotionRules] = await Promise.all([
    getLoopDeskMerchantSettings(resolved.shop.id),
    getCartIntelligenceSettings(resolved.shop.id),
    getLoopDeskRuntimeConfig(resolved.shop.id),
    getDelhiveryAdminConfig(resolved.shop.id),
    getRazorpayAdminConfig(resolved.shop.id),
    getPromotionRulesConfig(resolved.shop.id),
  ]);

  const shopParam = encodeURIComponent(resolved.shop.shopDomain);
  const settingsHref = withEmbeddedContext("/admin/merchant-settings", params, { shop: resolved.shop.shopDomain });
  const runtimeHref = `/api/runtime/config?shop=${shopParam}`;
  const installHref = `/api/auth/install?shop=${shopParam}`;
  const diagnosticsHref = withEmbeddedContext("/admin/diagnostics/environment", params, { shop: resolved.shop.shopDomain });
  const promotionRulesHref = withEmbeddedContext("/admin/promotion-rules", params, { shop: resolved.shop.shopDomain });
  const appEmbedDeepLink = `https://${resolved.shop.shopDomain}/admin/themes/current/editor?context=apps`;

  const coreEnvNames = ["DATABASE_URL", "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SHOPIFY_SCOPES"];
  const missingCoreEnv = coreEnvNames.filter((name) => !envPresent(name));
  const installationComplete = Boolean(
    resolved.shop.isActive &&
      resolved.shop.installedAt &&
      !resolved.shop.uninstalledAt &&
      resolved.shop.installationStatus === "ACTIVE",
  );
  const brandingComplete = Boolean(settings.branding.primaryColor && settings.labels.expressCheckoutText);
  const delhiveryComplete = Boolean(delhivery.enabled && delhivery.hasApiToken && delhivery.pickupLocation && delhivery.originPincode);
  const razorpayComplete = Boolean(razorpay.enabled && razorpay.keyId && razorpay.hasKeySecret);
  const runtimeComplete = Boolean(runtimeConfig.cart && runtimeConfig.branding && runtimeConfig.cartIntelligence && runtimeConfig.razorpay && runtimeConfig.delhivery);
  const cartIntelligenceConfigured = Boolean(cartIntelligence.enabled || cartIntelligence.freeShippingProgressEnabled || cartIntelligence.trustBadgesEnabled || cartIntelligence.dynamicBannerEnabled || cartIntelligence.upsellsEnabled || cartIntelligence.bundlesEnabled || cartIntelligence.aiRecommendationsEnabled || cartIntelligence.freeShippingThreshold > 0);
  const promotionRulesStatus = promotionRulesSetupStatus(promotionRules);
  const cartNeedsAttention = settings.cart.drawerMode === "loopdesk" || settings.cart.drawerMode === "auto";
  const ready = installationComplete && runtimeComplete && missingCoreEnv.length === 0 && brandingComplete && delhiveryComplete && razorpayComplete;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 rounded-2xl bg-gray-950 p-6 text-white shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">LoopDesk SaaS onboarding</p>
        <h1 className="mt-2 text-3xl font-semibold">Installation Wizard</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">
          Guide {resolved.shop.shopDomain} through install, OAuth, environment checks, theme app embed guidance, cart mode, branding, Delhivery, Razorpay, and launch readiness. This page reads existing configuration only and never exposes secrets.
        </p>
      </div>

      <div className="grid gap-5">
        <WizardStep
          number={1}
          title="Welcome"
          status="Complete"
          description="You are setting up LoopDesk for this Shopify shop. Keep this wizard URL open with the shop query parameter preserved."
          details={<p>Shop context: <strong>{resolved.shop.shopDomain}</strong></p>}
        />
        <WizardStep
          number={2}
          title="App installation status"
          status={installationComplete ? "Complete" : "Incomplete"}
          description="Confirms the app has an active installed Shop record from Shopify OAuth."
          details={<p>Installation status: <strong>{resolved.shop.installationStatus || "unknown"}</strong>. Active: <strong>{resolved.shop.isActive ? "Yes" : "No"}</strong>.</p>}
          actions={<LinkButton href={installHref}>Run install / OAuth</LinkButton>}
        />
        <WizardStep
          number={3}
          title="Environment validation"
          status={missingCoreEnv.length === 0 && runtimeComplete ? "Complete" : "Needs attention"}
          description="Checks required environment values by presence only and verifies runtime config resolves for this shop. Secret values are not displayed."
          details={<p>{missingCoreEnv.length ? `Missing environment values: ${missingCoreEnv.join(", ")}.` : "Required environment values are present."} Runtime config: <strong>{runtimeComplete ? "resolved" : "needs review"}</strong>.</p>}
          actions={<><LinkButton href={diagnosticsHref}>Open diagnostics JSON</LinkButton><LinkButton href={runtimeHref}>View safe runtime JSON</LinkButton></>}
        />
        <WizardStep
          number={4}
          title="Theme app embed guidance"
          status="Needs attention"
          description="Open the Shopify theme editor, enable the LoopDesk app embed, save the theme, then return here. The wizard does not modify theme settings."
          actions={<LinkButton href={appEmbedDeepLink}>Open theme app embeds</LinkButton>}
        />
        <WizardStep
          number={5}
          title="Cart mode guidance"
          status={cartNeedsAttention ? "Needs attention" : "Complete"}
          description="If you want LoopDesk Enhanced Drawer, set the Shopify theme cart type to Page, not Drawer. This prevents two drawers from competing."
          details={<p>Current LoopDesk drawer mode: <strong>{settings.cart.drawerMode}</strong>. This wizard does not auto-modify theme settings or cart behavior.</p>}
          actions={<LinkButton href={`${settingsHref}#cart`}>Review cart settings</LinkButton>}
        />
        <WizardStep
          number={6}
          title="Branding setup"
          status={brandingComplete ? "Complete" : "Incomplete"}
          description="Review merchant name, colors, logo, labels, and customer-facing support details used by LoopDesk runtime config."
          details={<p>Merchant name: <strong>{settings.general.merchantName}</strong>. Primary color: <strong>{settings.branding.primaryColor}</strong>.</p>}
          actions={<LinkButton href={`${settingsHref}#branding`}>Open branding settings</LinkButton>}
        />
        <WizardStep
          number={7}
          title="Delhivery setup status"
          status={delhiveryComplete ? "Complete" : delhivery.enabled ? "Needs attention" : "Incomplete"}
          description="Confirms Delhivery is enabled and has required merchant-level setup. API token values are masked and not shown."
          details={<p>Enabled: <strong>{delhivery.enabled ? "Yes" : "No"}</strong>. API token saved: <strong>{delhivery.hasApiToken ? "Yes" : "No"}</strong>. Pickup: <strong>{delhivery.pickupLocation || "missing"}</strong>. Origin pincode: <strong>{delhivery.originPincode || "missing"}</strong>.</p>}
          actions={<LinkButton href={`${settingsHref}#delhivery`}>Open Delhivery settings</LinkButton>}
        />
        <WizardStep
          number={8}
          title="Razorpay setup status"
          status={razorpayComplete ? "Complete" : razorpay.enabled ? "Needs attention" : "Incomplete"}
          description="Confirms Razorpay is enabled and has required merchant-level setup. Key secret and webhook secret are never exposed."
          details={<p>Enabled: <strong>{razorpay.enabled ? "Yes" : "No"}</strong>. Key ID: <strong>{razorpay.keyId ? "present" : "missing"}</strong>. Key secret saved: <strong>{razorpay.hasKeySecret ? "Yes" : "No"}</strong>. Environment: <strong>{razorpay.environment}</strong>.</p>}
          actions={<LinkButton href={`${settingsHref}#razorpay`}>Open Razorpay settings</LinkButton>}
        />

        <WizardStep
          number={9}
          title="Cart Intelligence setup status"
          status={cartIntelligenceConfigured ? "Complete" : "Incomplete"}
          description="Shows merchant-configurable Cart Intelligence setup status. This is configuration foundation only and may require later activation before any storefront feature renders."
          details={<p>Module key: <strong>cart_intelligence_config</strong>. Master enabled: <strong>{cartIntelligence.enabled ? "Yes" : "No"}</strong>. Free shipping progress: <strong>{cartIntelligence.freeShippingProgressEnabled ? "Yes" : "No"}</strong>. Threshold: <strong>{cartIntelligence.freeShippingThreshold}</strong>. Upsells, bundles, and AI flags are saved as safe public flags only.</p>}
          actions={<LinkButton href={`${settingsHref}#cart-intelligence`}>Open Cart Intelligence settings</LinkButton>}
        />
        <WizardStep
          number={10}
          title="Promotion Rules setup status"
          status={promotionRulesStatus === "Enabled with active rules" ? "Complete" : promotionRulesStatus === "Configured but disabled" ? "Needs attention" : "Incomplete"}
          description="Shows merchant Promotion Rules admin configuration status. This is setup visibility only and does not enable drawer rendering or checkout discounts."
          details={<p>Status: <strong>{promotionRulesStatus}</strong>. Module enabled: <strong>{promotionRules.enabled ? "Yes" : "No"}</strong>. Rules saved: <strong>{promotionRules.rules.length}</strong>. Active enabled rules: <strong>{promotionRules.rules.filter((rule) => rule.enabled && rule.status === "active").length}</strong>.</p>}
          actions={<LinkButton href={promotionRulesHref}>Open Promotion Rules</LinkButton>}
        />
        <WizardStep
          number={11}
          title="Ready / launch checklist"
          status={ready ? "Complete" : "Needs attention"}
          description="Launch once install, OAuth, environment validation, theme embed, cart guidance, branding, Delhivery, and Razorpay are reviewed."
          details={<ul className="list-disc space-y-1 pl-5"><li>Runtime config reads loopdesk_runtime_config, cart_intelligence_config, delhivery_config, and razorpay_config.</li><li>No checkout, payment execution, shipment creation, OTP, cart logic, analytics, upsell, or AI behavior is changed by this wizard.</li><li>Preserved shop parameter: {resolved.shop.shopDomain}</li></ul>}
        />
      </div>
    </main>
  );
}
