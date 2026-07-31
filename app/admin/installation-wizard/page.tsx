import {
  getCartIntelligenceSettings,
  getLoopDeskMerchantSettings,
  getLoopDeskRuntimeConfig,
} from "../../../services/loopdesk/merchant-settings";
import { getDelhiveryAdminConfig } from "../../../services/delhivery/config";
import { getRazorpayAdminConfig } from "../../../services/razorpay/config";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromSearchParams,
} from "../../../services/shopify/admin-shop-context";

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

function envPresent(name: string) {
  return Boolean(String(process.env[name] || "").trim());
}

function badgeClass(status: WizardStatus) {
  if (status === "Complete") return "mk-badge mk-badge-success";
  if (status === "Needs attention") return "mk-badge mk-badge-warning";
  return "mk-badge mk-badge-neutral";
}

function StatusPill({ status }: { status: WizardStatus }) {
  return <span className={badgeClass(status)}>{status}</span>;
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="mk-btn mk-btn-sm" href={href}>
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
    <section className="mk-card" style={{ display: "grid", gap: 16 }}>
      <div className="mk-page-header" style={{ alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <div
            style={{
              display: "flex",
              height: 36,
              width: 36,
              flexShrink: 0,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 999,
              background: "var(--primary)",
              color: "#fff",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            {number}
          </div>
          <div>
            <h2 className="mk-section-title" style={{ margin: 0 }}>{title}</h2>
            <p className="mk-section-subtitle" style={{ margin: "4px 0 0" }}>{description}</p>
          </div>
        </div>
        <StatusPill status={status} />
      </div>
      {details ? <div className="mk-card" style={{ background: "var(--panel-2)", padding: 16, fontSize: 14, color: "var(--muted)" }}>{details}</div> : null}
      {actions ? <div className="mk-header-actions">{actions}</div> : null}
    </section>
  );
}

export default async function InstallationWizardPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const resolved = await resolveAdminShopFromSearchParams(params);

  if (!resolved.shop?.id) {
    return (
      <main className="mk-page mx-auto max-w-3xl">
        <header className="mk-page-header">
          <div><h1 className="mk-page-title">Installation Wizard</h1></div>
        </header>
        <div className="mk-alert mk-alert-error" role="alert">
          {formatAdminShopResolutionError(resolved)}
        </div>
        {resolved.shopDomain ? (
          <a className="mk-btn mk-btn-primary" href={`/api/auth/install?shop=${encodeURIComponent(resolved.shopDomain)}`}>
            Reinstall the Shopify app for {resolved.shopDomain}
          </a>
        ) : null}
      </main>
    );
  }

  const [settings, cartIntelligence, runtimeConfig, delhivery, razorpay] = await Promise.all([
    getLoopDeskMerchantSettings(resolved.shop.id),
    getCartIntelligenceSettings(resolved.shop.id),
    getLoopDeskRuntimeConfig(resolved.shop.id),
    getDelhiveryAdminConfig(resolved.shop.id),
    getRazorpayAdminConfig(resolved.shop.id),
  ]);

  const shopParam = encodeURIComponent(resolved.shop.shopDomain);
  const embeddedContext = new URLSearchParams();
  embeddedContext.set("shop", resolved.shop.shopDomain);
  if (params.host) embeddedContext.set("host", params.host);
  if (params.embedded) embeddedContext.set("embedded", params.embedded);
  const settingsHref = `/admin/merchant-settings?${embeddedContext.toString()}`;
  const runtimeHref = `/api/runtime/config?shop=${shopParam}`;
  const installHref = `/api/auth/install?shop=${shopParam}`;
  const diagnosticsHref = `/admin/diagnostics/environment?${embeddedContext.toString()}`;
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
  const cartIntelligenceConfigured = Boolean(cartIntelligence.enabled || cartIntelligence.cartGoalProgress.enabled || cartIntelligence.trustBadgesEnabled || cartIntelligence.dynamicBannerEnabled || cartIntelligence.upsellsEnabled || cartIntelligence.bundlesEnabled || cartIntelligence.aiRecommendationsEnabled || (cartIntelligence.cartGoalProgress.targetAmountMinor || 0) > 0);
  const cartNeedsAttention = settings.cart.drawerMode === "loopdesk" || settings.cart.drawerMode === "auto";
  const ready = installationComplete && runtimeComplete && missingCoreEnv.length === 0 && brandingComplete && delhiveryComplete && razorpayComplete;

  return (
    <main className="mk-page mx-auto max-w-5xl">
      <div className="mk-hero">
        <p className="mk-hero-tagline">LoopD2C SaaS onboarding</p>
        <h1 className="mk-hero-title">Installation Wizard</h1>
        <p className="mk-hero-subtitle">
          Guide {resolved.shop.shopDomain} through install, OAuth, environment checks, theme app embed guidance, cart mode, branding, Delhivery, Razorpay, and launch readiness. This page reads existing configuration only and never exposes secrets.
        </p>
      </div>

      <div style={{ display: "grid", gap: 20 }}>
        <WizardStep
          number={1}
          title="Welcome"
          status="Complete"
          description="You are setting up LoopD2C for this Shopify shop. Keep this wizard URL open with the shop query parameter preserved."
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
          actions={<><LinkButton href={diagnosticsHref}>Open diagnostics</LinkButton><LinkButton href={runtimeHref}>View safe runtime config</LinkButton></>}
        />
        <WizardStep
          number={4}
          title="Theme app embed guidance"
          status="Needs attention"
          description="Open the Shopify theme editor, enable the LoopD2C app embed, save the theme, then return here. The wizard does not modify theme settings."
          actions={<LinkButton href={appEmbedDeepLink}>Open theme app embeds</LinkButton>}
        />
        <WizardStep
          number={5}
          title="Cart mode guidance"
          status={cartNeedsAttention ? "Needs attention" : "Complete"}
          description="If you want LoopD2C Enhanced Drawer, set the Shopify theme cart type to Page, not Drawer. This prevents two drawers from competing."
          details={<p>Current LoopD2C drawer mode: <strong>{settings.cart.drawerMode}</strong>. This wizard does not auto-modify theme settings or cart behavior.</p>}
          actions={<LinkButton href={`${settingsHref}#cart`}>Review cart settings</LinkButton>}
        />
        <WizardStep
          number={6}
          title="Branding setup"
          status={brandingComplete ? "Complete" : "Incomplete"}
          description="Review merchant name, colors, logo, labels, and customer-facing support details used by LoopD2C runtime config."
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
          details={<p>Master enabled: <strong>{cartIntelligence.enabled ? "Yes" : "No"}</strong>. Cart goal progress: <strong>{cartIntelligence.cartGoalProgress.enabled ? "Yes" : "No"}</strong>. Target: <strong>{cartIntelligence.cartGoalProgress.targetAmountMinor == null ? "Not set" : cartIntelligence.cartGoalProgress.targetAmountMinor / 100}</strong>. Upsells, bundles, and AI flags are saved as safe public flags only.</p>}
          actions={<LinkButton href={`${settingsHref}#cart-intelligence`}>Open Cart Intelligence settings</LinkButton>}
        />
        <WizardStep
          number={10}
          title="Ready / launch checklist"
          status={ready ? "Complete" : "Needs attention"}
          description="Launch once install, OAuth, environment validation, theme embed, cart guidance, branding, Delhivery, and Razorpay are reviewed."
          details={<ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 4 }}><li>Runtime config reads loopdesk_runtime_config, cart_intelligence_config, delhivery_config, and razorpay_config.</li><li>No checkout, payment execution, shipment creation, OTP, cart logic, analytics, upsell, or AI behavior is changed by this wizard.</li><li>Preserved shop parameter: {resolved.shop.shopDomain}</li></ul>}
        />
      </div>
    </main>
  );
}
