import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getCartIntelligenceSettings,
  getLoopDeskMerchantSettings,
  updateCartIntelligenceSettings,
  updateLoopDeskMerchantSettings,
} from "../../../services/loopdesk/merchant-settings";
import { CART_DRAWER_MODULE_SLOTS, type CartDrawerModuleKey } from "../../../services/cart-intelligence/modules/types";
import {
  getDelhiveryAdminConfig,
  updateDelhiveryConfig,
} from "../../../services/delhivery/config";
import {
  getRazorpayAdminConfig,
  updateRazorpayConfig,
} from "../../../services/razorpay/config";
import {
  formatAdminShopResolutionError,
  resolveAdminShopFromSearchParams,
} from "../../../services/shopify/admin-shop-context";
import {
  getMerchantNotificationSettings,
  saveMerchantNotificationSettings,
  MerchantNotificationSettingsValidationError,
} from "../../../services/settings/merchant-notifications";
import {
  getMerchantOtpSettings,
  saveMerchantOtpSettings,
  MerchantOtpSettingsValidationError,
  getPlatformTwilioConfigurationStatus,
} from "../../../services/settings/merchant-otp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    shop?: string;
    shopify_shop?: string;
    host?: string;
    hmac?: string;
    embedded?: string;
    saved?: string;
    error?: string;
  }>;
};


type EmbeddedContextInput = { shop?: string; host?: string; embedded?: string; saved?: string | null; error?: string | null };

function embeddedContextFromFormData(formData: FormData) {
  const params = new URLSearchParams();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("embeddedContext:")) continue;
    const paramKey = key.slice("embeddedContext:".length);
    if (typeof value === "string" && value) params.set(paramKey, value);
  }
  return params;
}

function embeddedContextHiddenInputs(params: EmbeddedContextInput) {
  return Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]));
}

function withEmbeddedContext(pathname: string, params: EmbeddedContextInput, overrides: EmbeddedContextInput = {}) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value === null || value === undefined || value === "") continue;
    next.set(key, value);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

const SHOP_UNRESOLVED_MESSAGE =
  "Unable to resolve shop. Open this page from Shopify admin or add a shop query parameter.";

const cardClass = "rounded-2xl border border-gray-200 bg-white p-6 shadow-sm";
const helpClass = "text-xs leading-5 text-gray-500";

async function saveMerchantSettings(
  shopId: string,
  shopDomain: string,
  formData: FormData,
) {
  "use server";
  const resolved = await resolveAdminShopFromSearchParams({ shop: shopDomain });
  if (!shopId || !resolved.shop?.id || resolved.shop.id !== shopId) {
    redirect(
      `/admin/merchant-settings?shop=${encodeURIComponent(shopDomain)}&error=${encodeURIComponent(SHOP_UNRESOLVED_MESSAGE)}`,
    );
  }

  const embeddedContext = embeddedContextFromFormData(formData);
  embeddedContext.set("shop", shopDomain);
  embeddedContext.set("saved", "1");
  embeddedContext.delete("error");
  let redirectUrl = `/admin/merchant-settings?${embeddedContext.toString()}`;
  try {
    await updateLoopDeskMerchantSettings(shopId, {
      general: {
        merchantName: formData.get("merchantName"),
        supportEmail: formData.get("supportEmail"),
        supportPhone: formData.get("supportPhone"),
        supportWhatsApp: formData.get("supportWhatsApp"),
      },
      branding: {
        logoUrl: formData.get("logoUrl"),
        primaryColor: formData.get("primaryColor"),
        secondaryColor: formData.get("secondaryColor"),
        accentColor: formData.get("accentColor"),
        borderRadius: formData.get("borderRadius"),
        showPoweredBy: formData.get("showPoweredBy") === "on",
        poweredByText: formData.get("poweredByText"),
      },
      labels: {
        expressCheckoutText: formData.get("expressCheckoutText"),
        viewCartText: formData.get("viewCartText"),
        secureCheckoutText: formData.get("secureCheckoutText"),
      },
      cart: {
        drawerMode: formData.get("drawerMode"),
        openAfterAddToCart: formData.get("openAfterAddToCart") === "on",
        expressCheckoutButtonEnabled:
          formData.get("expressCheckoutButtonEnabled") === "on",
        viewCartButtonEnabled: formData.get("viewCartButtonEnabled") === "on",
      },
      checkout: {
        showSecureBadge: formData.get("showSecureBadge") === "on",
        showTrustCopy: formData.get("showTrustCopy") === "on",
      },
      otpModalBranding: {
        logoUrl: formData.get("otpLogoUrl"),
        logoAlt: formData.get("otpLogoAlt"),
        fallbackBrandText: formData.get("otpFallbackBrandText"),
        heading: formData.get("otpHeading"),
        description: formData.get("otpDescription"),
        promotionEnabled: formData.get("otpPromotionEnabled") === "on",
        promotionBadgeText: formData.get("otpPromotionBadgeText"),
        promotionMessage: formData.get("otpPromotionMessage"),
        showTrustItems: formData.get("otpShowTrustItems") === "on",
        trustItem1: formData.get("otpTrustItem1"),
        trustItem2: formData.get("otpTrustItem2"),
        trustItem3: formData.get("otpTrustItem3"),
        privacyText: formData.get("otpPrivacyText"),
        inputHelperText: formData.get("otpInputHelperText"),
      },
    });
    await updateCartIntelligenceSettings(shopId, {
      enabled: formData.get("cartIntelligenceEnabled") === "on",
      cartGoalProgressEnabled: formData.get("cartGoalProgressEnabled") === "on",
      targetAmount: formData.get("targetAmount"),
      goalName: formData.get("goalName"),
      progressText: formData.get("progressText"),
      unlockedText: formData.get("unlockedText"),
      hideAfterUnlock: formData.get("hideAfterUnlock") === "on",
      trustBadgesEnabled: formData.get("trustBadgesEnabled") === "on",
      trustBadges: {
        enabled: formData.get("trustBadgesEnabled") === "on",
        placement: formData.get("trustBadgesPlacement"),
        layout: formData.get("trustBadgesLayout"),
        items: Array.from({ length: 6 }, (_, index) => ({
          id: formData.get(`trustBadgeId${index}`),
          enabled: formData.get(`trustBadgeEnabled${index}`) === "on",
          icon: formData.get(`trustBadgeIcon${index}`),
          label: formData.get(`trustBadgeLabel${index}`),
          sortOrder: formData.get(`trustBadgeSortOrder${index}`),
        })),
      },
      dynamicBannerEnabled: formData.get("dynamicBannerEnabled") === "on",
      dynamicBannerText: formData.get("dynamicBannerText"),
      upsellsEnabled: formData.get("upsellsEnabled") === "on",
      bundlesEnabled: formData.get("bundlesEnabled") === "on",
      aiRecommendationsEnabled: formData.get("aiRecommendationsEnabled") === "on",
      cartDrawerModules: {
        schemaVersion: 1,
        modules: ["CART_GOAL_PROGRESS", "TRUST_BADGES", "CHECKOUT_REASSURANCE"].map((key) => ({
          key,
          enabled: formData.get(`cartDrawerModuleEnabled:${key}`) === "on",
          slot: formData.get(`cartDrawerModuleSlot:${key}`),
          sortOrder: formData.get(`cartDrawerModuleOrder:${key}`),
        })),
      },
    });
    await updateRazorpayConfig(shopId, {
      enabled: formData.get("razorpayEnabled") === "on",
      environment: formData.get("razorpayEnvironment"),
      keyId: formData.get("razorpayKeyId"),
      keySecret: formData.get("razorpayKeySecret"),
      webhookSecret: formData.get("razorpayWebhookSecret"),
      currency: formData.get("razorpayCurrency"),
      captureMode: formData.get("razorpayCaptureMode"),
      upiEnabled: formData.get("razorpayUpiEnabled") === "on",
      cardsEnabled: formData.get("razorpayCardsEnabled") === "on",
      netBankingEnabled: formData.get("razorpayNetBankingEnabled") === "on",
      walletsEnabled: formData.get("razorpayWalletsEnabled") === "on",
      codFallbackEnabled: formData.get("razorpayCodFallbackEnabled") === "on",
    });
    await updateDelhiveryConfig(shopId, {
      enabled: formData.get("delhiveryEnabled") === "on",
      environment: formData.get("delhiveryEnvironment"),
      apiToken: formData.get("delhiveryApiToken"),
      pickupLocation: formData.get("delhiveryPickupLocation"),
      originPincode: formData.get("delhiveryOriginPincode"),
      codEnabled: formData.get("delhiveryCodEnabled") === "on",
      prepaidEnabled: formData.get("delhiveryPrepaidEnabled") === "on",
      serviceabilityCheckEnabled:
        formData.get("delhiveryServiceabilityCheckEnabled") === "on",
      defaultPackageWeight: formData.get("delhiveryDefaultPackageWeight"),
      defaultLength: formData.get("delhiveryDefaultLength"),
      defaultBreadth: formData.get("delhiveryDefaultBreadth"),
      defaultHeight: formData.get("delhiveryDefaultHeight"),
    });
    await saveMerchantOtpSettings(shopId, {
      otpEnabled: formData.getAll("otpEnabled").at(-1),
      providerMode: formData.get("otpProviderMode"),
      allowPlatformFallback: formData.getAll("otpAllowPlatformFallback").at(-1),
    });
    await saveMerchantNotificationSettings(shopId, {
      emailEnabled: formData.getAll("notificationEmailEnabled").at(-1),
      customerEmailsEnabled: formData.getAll("notificationCustomerEmailsEnabled").at(-1),
      senderDisplayName: formData.get("notificationSenderDisplayName"),
      replyToEmail: formData.get("notificationReplyToEmail"),
      adminRecipients: formData.get("notificationAdminRecipients"),
      cancellationAlerts: formData.getAll("notificationCancellationAlerts").at(-1),
      exchangeAlerts: formData.getAll("notificationExchangeAlerts").at(-1),
      issueAlerts: formData.getAll("notificationIssueAlerts").at(-1),
      storeCreditAlerts: formData.getAll("notificationStoreCreditAlerts").at(-1),
      checkoutAlerts: formData.getAll("notificationCheckoutAlerts").at(-1),
    });
    revalidatePath(`/admin/merchant-settings?shop=${encodeURIComponent(shopDomain)}`);
    revalidatePath("/admin/merchant-settings");
  } catch (error) {
    const message =
      error instanceof MerchantNotificationSettingsValidationError || error instanceof MerchantOtpSettingsValidationError || error instanceof Error ? error.message : "Invalid merchant settings.";
    embeddedContext.delete("saved");
    embeddedContext.set("error", message);
    redirectUrl = `/admin/merchant-settings?${embeddedContext.toString()}`;
  }
  redirect(redirectUrl);
}

function Field(props: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  help?: string;
  placeholder?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-gray-800">
      <span>{props.label}</span>
      <input
        className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        name={props.name}
        type={props.type || "text"}
        defaultValue={props.defaultValue || ""}
        placeholder={props.placeholder}
      />
      {props.help ? <span className={helpClass}>{props.help}</span> : null}
    </label>
  );
}
function Check(props: {
  label: string;
  name: string;
  defaultChecked: boolean;
  help?: string;
}) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-800">
      <input
        className="mt-1"
        name={props.name}
        type="checkbox"
        defaultChecked={props.defaultChecked}
      />
      <span>
        <span className="font-medium">{props.label}</span>
        {props.help ? <span className={`block ${helpClass}`}>{props.help}</span> : null}
      </span>
    </label>
  );
}

function TextArea(props: { label: string; name: string; defaultValue?: string | null; help?: string; placeholder?: string; }) {
  return (
    <label className="grid gap-2 text-sm font-medium text-gray-800">
      <span>{props.label}</span>
      <textarea
        className="min-h-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10"
        name={props.name}
        defaultValue={props.defaultValue || ""}
        placeholder={props.placeholder}
      />
      {props.help ? <span className={helpClass}>{props.help}</span> : null}
    </label>
  );
}

function NotificationCheck(props: { label: string; name: string; defaultChecked: boolean; help?: string; }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-800">
      <input type="hidden" name={props.name} value="false" />
      <input className="mt-1" name={props.name} type="checkbox" value="true" defaultChecked={props.defaultChecked} />
      <span>
        <span className="font-medium">{props.label}</span>
        {props.help ? <span className={`block ${helpClass}`}>{props.help}</span> : null}
      </span>
    </label>
  );
}

function SectionHeader(props: { title: string; description: string }) {
  return (
    <div className="border-b border-gray-100 pb-4">
      <h2 className="text-lg font-semibold text-gray-950">{props.title}</h2>
      <p className="mt-1 text-sm leading-6 text-gray-600">{props.description}</p>
    </div>
  );
}

export default async function MerchantSettingsPage({
  searchParams,
}: PageProps) {
  const params = searchParams ? await searchParams : {};
  const resolved = await resolveAdminShopFromSearchParams(params);
  if (!resolved.shop?.id)
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className={cardClass}>
          <h1 className="text-2xl font-semibold">Merchant Settings</h1>
          <p className="mt-3 text-sm text-red-700">
            {params.error || formatAdminShopResolutionError(resolved)}
          </p>
          {resolved.shopDomain ? (
            <p className="mt-4 text-sm">
              <a
                className="font-medium text-blue-700 underline"
                href={`/api/auth/install?shop=${encodeURIComponent(resolved.shopDomain)}`}
              >
                Reinstall the Shopify app for {resolved.shopDomain}
              </a>
            </p>
          ) : null}
        </div>
      </main>
    );
  const [settings, cartIntelligence, delhivery, razorpay, notificationSettings, otpSettings] = await Promise.all([
    getLoopDeskMerchantSettings(resolved.shop.id),
    getCartIntelligenceSettings(resolved.shop.id),
    getDelhiveryAdminConfig(resolved.shop.id),
    getRazorpayAdminConfig(resolved.shop.id),
    getMerchantNotificationSettings(resolved.shop.id),
    getMerchantOtpSettings(resolved.shop.id),
  ]);
  const platformTwilio = getPlatformTwilioConfigurationStatus();
  const configurableCartModules: Array<{ key: CartDrawerModuleKey; label: string }> = [
    { key: "CART_GOAL_PROGRESS", label: "Cart Goal Progress" },
    { key: "TRUST_BADGES", label: "Trust Badges" },
    { key: "CHECKOUT_REASSURANCE", label: "Checkout Reassurance" },
  ];
  const shopParam = encodeURIComponent(resolved.shop.shopDomain);
  const saveAction = saveMerchantSettings.bind(
    null,
    resolved.shop.id,
    resolved.shop.shopDomain,
  );
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-6 flex flex-col gap-4 rounded-2xl bg-gray-950 p-6 text-white shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-300">
            LoopDesk runtime settings
          </p>
          <h1 className="mt-2 text-3xl font-semibold">Merchant Settings</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">
            Manage storefront drawer branding and labels for {resolved.shop.shopDomain}.
            Saves are persisted to ShopModuleConfig with moduleKey
            loopdesk_runtime_config and exposed through the runtime config endpoints.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          <a className="rounded-lg bg-white/10 px-3 py-2 font-medium hover:bg-white/20" href={withEmbeddedContext("/", params, { shop: resolved.shop.shopDomain, saved: null, error: null })}>
            Dashboard
          </a>
          <a className="rounded-lg bg-white/10 px-3 py-2 font-medium hover:bg-white/20" href={`/api/runtime/config?shop=${shopParam}`}>
            View runtime JSON
          </a>
        </div>
      </div>
      {params.saved === "1" ? (
        <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">
          Merchant settings saved. Reload the storefront to refresh window.LoopDeskConfig.
        </div>
      ) : null}
      {params.error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">
          {params.error}
        </div>
      ) : null}
      <form action={saveAction} className="grid gap-6">
        <input type="hidden" name="shop" value={resolved.shop.shopDomain} />
        {embeddedContextHiddenInputs(params).map(([key, value]) => <input key={key} type="hidden" name={`embeddedContext:${key}`} value={value} />)}
        <section className={`${cardClass} grid gap-5`}>
          <SectionHeader title="General" description="Customer-facing store and support details. Keep these short and public-safe." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Merchant name" name="merchantName" defaultValue={settings.general.merchantName} help="Shown in LoopDesk drawer branding." />
            <Field label="Support email" name="supportEmail" type="email" defaultValue={settings.general.supportEmail} help="Optional public support contact." />
            <Field label="Support phone" name="supportPhone" defaultValue={settings.general.supportPhone} help="Optional public support phone." />
            <Field label="Support WhatsApp" name="supportWhatsApp" defaultValue={settings.general.supportWhatsApp} help="Optional public WhatsApp contact." />
          </div>
        </section>
        <section id="branding" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Branding" description="Safe public styling values used by the drawer and runtime config." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Logo URL" name="logoUrl" defaultValue={settings.branding.logoUrl} placeholder="https://cdn.shopify.com/..." help="HTTP(S) image URL only; secrets are never stored here." />
            <Field label="Primary color" name="primaryColor" defaultValue={settings.branding.primaryColor} placeholder="#111827" help="Hex, rgb/rgba, or hsl/hsla." />
            <Field label="Secondary color" name="secondaryColor" defaultValue={settings.branding.secondaryColor} placeholder="#374151" help="Used for supporting UI accents." />
            <Field label="Accent color" name="accentColor" defaultValue={settings.branding.accentColor} placeholder="#2563eb" help="Used for highlight actions." />
            <Field label="Border radius" name="borderRadius" defaultValue={settings.branding.borderRadius} placeholder="16px" help="Use 0, px, rem, em, or percent values." />
            <Field label="Powered by text" name="poweredByText" defaultValue={settings.branding.poweredByText} help="Shown only when Powered by is enabled." />
          </div>
          <Check label="Show Powered by" name="showPoweredBy" defaultChecked={settings.branding.showPoweredBy} help="Toggle the drawer footer attribution." />
        </section>
        <section className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Drawer labels" description="Button and reassurance copy rendered in the storefront cart drawer." />
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Express checkout text" name="expressCheckoutText" defaultValue={settings.labels.expressCheckoutText} />
            <Field label="View cart text" name="viewCartText" defaultValue={settings.labels.viewCartText} />
            <Field label="Secure checkout text" name="secureCheckoutText" defaultValue={settings.labels.secureCheckoutText} />
          </div>
        </section>
        <section id="cart" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Cart behavior" description="Choose whether LoopDesk owns the drawer or allows the theme cart to continue." />
          <label className="grid gap-2 text-sm font-medium text-gray-800">
            <span>Drawer mode</span>
            <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10" name="drawerMode" defaultValue={settings.cart.drawerMode}>
              <option value="auto">Auto</option>
              <option value="loopdesk">LoopDesk Enhanced Drawer</option>
              <option value="theme">Theme drawer</option>
            </select>
          </label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
            To use LoopDesk Enhanced Drawer, set your Shopify theme cart type/cart style to Page.
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <Check label="Open after add to cart" name="openAfterAddToCart" defaultChecked={settings.cart.openAfterAddToCart} help="Opens LoopDesk drawer after cart add when LoopDesk drawer is active." />
            <Check label="Express checkout button" name="expressCheckoutButtonEnabled" defaultChecked={settings.cart.expressCheckoutButtonEnabled} help="Keeps Express Checkout visible in drawer." />
            <Check label="View cart button" name="viewCartButtonEnabled" defaultChecked={settings.cart.viewCartButtonEnabled} help="Keeps the standard cart link visible." />
          </div>
        </section>

        <section id="otp-modal-branding" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="OTP Modal Branding & Content" description="Presentation-only OTP modal settings. These values do not change OTP logic, authentication, sessions, checkout continuation, or discount rules." />
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">
            Use your store logo URL or upload/select a logo supported by the existing admin asset workflow. Promotional copy is display-only and is not coupled to active promotion rules or discount codes.
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Logo URL" name="otpLogoUrl" defaultValue={settings.otpModalBranding.logoUrl} placeholder="https://cdn.shopify.com/..." help="Optional app-hosted, Shopify CDN, or secure HTTPS image URL." />
            <Field label="Logo alt text" name="otpLogoAlt" defaultValue={settings.otpModalBranding.logoAlt} help="Optional; defaults to the merchant/shop name." />
            <Field label="Fallback brand text" name="otpFallbackBrandText" defaultValue={settings.otpModalBranding.fallbackBrandText} help="Shown if the image is missing or fails. Defaults to the Shopify shop name, then Secure Login." />
            <Field label="Modal heading" name="otpHeading" defaultValue={settings.otpModalBranding.heading} />
            <Field label="Modal description" name="otpDescription" defaultValue={settings.otpModalBranding.description} />
            <Field label="OTP input helper text" name="otpInputHelperText" defaultValue={settings.otpModalBranding.inputHelperText} />
            <Field label="Privacy/helper text" name="otpPrivacyText" defaultValue={settings.otpModalBranding.privacyText} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Show promotional banner" name="otpPromotionEnabled" defaultChecked={settings.otpModalBranding.promotionEnabled} help="Disabled by default for new merchants; preserve merchant-specific offers with saved values only." />
            <Check label="Show trust items" name="otpShowTrustItems" defaultChecked={settings.otpModalBranding.showTrustItems} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Promotional badge text" name="otpPromotionBadgeText" defaultValue={settings.otpModalBranding.promotionBadgeText} placeholder="15% OFF" />
            <Field label="Promotional message" name="otpPromotionMessage" defaultValue={settings.otpModalBranding.promotionMessage} placeholder="Use Code: MEGA15" />
            <Field label="Trust item 1" name="otpTrustItem1" defaultValue={settings.otpModalBranding.trustItems[0]} />
            <Field label="Trust item 2" name="otpTrustItem2" defaultValue={settings.otpModalBranding.trustItems[1]} />
            <Field label="Trust item 3" name="otpTrustItem3" defaultValue={settings.otpModalBranding.trustItems[2]} />
          </div>
        </section>

        <section id="otp-provider" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="OTP provider" description="LoopDesk currently sends OTPs using the platform-managed Twilio Verify service. Merchant-owned Twilio and MSG91 connections can be configured after provider verification support is enabled." />
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">
            These settings now control whether LoopDesk uses the platform-managed Twilio service for this shop. Merchant-owned providers remain unavailable until secure credential verification is implemented.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <NotificationCheck label="Enable OTP authentication" name="otpEnabled" defaultChecked={otpSettings.otpEnabled} help="When disabled, OTP requests are unavailable. This does not bypass authentication requirements." />
            <NotificationCheck label="Allow platform Twilio fallback" name="otpAllowPlatformFallback" defaultChecked={otpSettings.allowPlatformFallback} help="Allows LoopDesk managed Twilio to handle OTPs when a merchant-owned provider is unavailable." />
          </div>
          <label className="grid gap-2 text-sm font-medium text-gray-800">
            <span>Preferred OTP provider</span>
            <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10" name="otpProviderMode" defaultValue={otpSettings.providerMode}>
              <option value="PLATFORM_TWILIO">LoopDesk managed Twilio</option>
              <option value="MERCHANT_TWILIO" disabled>Use my Twilio account — coming after verification support</option>
              <option value="MERCHANT_MSG91" disabled>Use my MSG91 account — coming after approval support</option>
            </select>
            <span className={helpClass}>Mock is development-only and is not exposed in merchant admin.</span>
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <h3 className="font-semibold text-gray-950">Platform Twilio</h3>
              <p className="mt-2">Status: {platformTwilio.configured ? "Configured" : "Not configured"}</p>
              <p className={helpClass}>Checks only whether account SID, auth token, and Verify Service SID are present. Secret values are not displayed.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <h3 className="font-semibold text-gray-950">Merchant Twilio</h3>
              <p className="mt-2">Status: {otpSettings.merchantTwilioStatus.replaceAll("_", " ").toLowerCase()}</p>
              <p className={helpClass}>Future setup requires Account SID, Auth Token, and Verify Service SID. Credential entry is deferred until write-only secret handling is implemented for this provider.</p>
            </div>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
              <h3 className="font-semibold text-gray-950">Merchant MSG91</h3>
              <p className="mt-2">Status: {otpSettings.merchantMsg91Status.replaceAll("_", " ").toLowerCase()}</p>
              <p className={helpClass}>Activation will require KYC approval, DLT approval, template approval, and provider verification.</p>
            </div>
          </div>
        </section>

        <section id="email-notifications" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Email notifications" description="LoopDesk can send operational and customer notification emails using the platform-managed email service. Configure who should receive store alerts and which notification categories are enabled." />
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-medium text-blue-900">
            These settings control the store-admin recipients and operational alert categories used by LoopDesk. Emails are sent through the platform-managed email service.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <NotificationCheck label="Enable email notifications" name="notificationEmailEnabled" defaultChecked={notificationSettings.emailEnabled} />
            <NotificationCheck label="Enable customer notification emails" name="notificationCustomerEmailsEnabled" defaultChecked={notificationSettings.customerEmailsEnabled} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Sender display name" name="notificationSenderDisplayName" defaultValue={notificationSettings.senderDisplayName} help="Display name only; not a sender email address." />
            <Field label="Reply-to email" name="notificationReplyToEmail" type="email" defaultValue={notificationSettings.replyToEmail} help="Optional merchant reply-to address for future notification routing." />
          </div>
          <TextArea label="Admin recipients" name="notificationAdminRecipients" defaultValue={notificationSettings.adminRecipients.join("\n")} help={notificationSettings.adminRecipients.length ? "Enter up to 10 email addresses. Separate addresses using commas or new lines." : "Add at least one admin recipient to receive store operational alerts."} />
          <div className="grid gap-3 md:grid-cols-2">
            <NotificationCheck label="Cancellation alerts" name="notificationCancellationAlerts" defaultChecked={notificationSettings.cancellationAlerts} />
            <NotificationCheck label="Exchange alerts" name="notificationExchangeAlerts" defaultChecked={notificationSettings.exchangeAlerts} />
            <NotificationCheck label="Issue-reporting alerts" name="notificationIssueAlerts" defaultChecked={notificationSettings.issueAlerts} />
            <NotificationCheck label="Store-credit alerts" name="notificationStoreCreditAlerts" defaultChecked={notificationSettings.storeCreditAlerts} />
            <NotificationCheck label="Checkout or order alerts" name="notificationCheckoutAlerts" defaultChecked={notificationSettings.checkoutAlerts} />
          </div>
        </section>

        <section className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Checkout reassurance" description="Non-payment display controls only. Payment, OTP, and order logic are unchanged." />
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Show secure badge" name="showSecureBadge" defaultChecked={settings.checkout.showSecureBadge} />
            <Check label="Show trust copy" name="showTrustCopy" defaultChecked={settings.checkout.showTrustCopy} />
          </div>
        </section>


        <section id="cart-intelligence" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Cart Intelligence" description="Merchant-configured storefront guidance for the cart drawer." />
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">
            This is a storefront display goal only. It does not change Shopify shipping rates, discounts, or checkout eligibility. Configure the corresponding rule separately in Shopify.
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Cart Intelligence Enabled" name="cartIntelligenceEnabled" defaultChecked={cartIntelligence.enabled} help="Master public flag for future Cart Intelligence experiences; disabled by default." />
            <Check label="Cart Goal Progress Enabled" name="cartGoalProgressEnabled" defaultChecked={cartIntelligence.cartGoalProgress.enabled} help="Shows the merchant-authored display goal in the cart drawer." />
            <Check label="Dynamic Banner Enabled" name="dynamicBannerEnabled" defaultChecked={cartIntelligence.dynamicBannerEnabled} help="Stores whether a future cart banner may be shown." />
            <Check label="Upsells Enabled" name="upsellsEnabled" defaultChecked={cartIntelligence.upsellsEnabled} help="Configuration flag only; no upsell logic is implemented in this phase." />
            <Check label="Bundles Enabled" name="bundlesEnabled" defaultChecked={cartIntelligence.bundlesEnabled} help="Configuration flag only; no bundle logic is implemented in this phase." />
            <Check label="AI Recommendations Enabled" name="aiRecommendationsEnabled" defaultChecked={cartIntelligence.aiRecommendationsEnabled} help="Configuration flag only; no AI recommendations are implemented in this phase." />
          </div>
          <div className="grid gap-4 rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Check label="Trust Badges Enabled" name="trustBadgesEnabled" defaultChecked={cartIntelligence.trustBadges.enabled} help="Master switch. Individual claims remain disabled until you approve them." />
              <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Placement</span><select className="rounded-lg border border-gray-300 bg-white px-3 py-2" name="trustBadgesPlacement" defaultValue={cartIntelligence.trustBadges.placement}><option value="BELOW_TOTALS">Below totals</option><option value="BELOW_CHECKOUT_BUTTON">Below checkout button</option></select></label>
              <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Layout</span><select className="rounded-lg border border-gray-300 bg-white px-3 py-2" name="trustBadgesLayout" defaultValue={cartIntelligence.trustBadges.layout}><option value="GRID">Grid</option><option value="ROW">Row</option></select></label>
            </div>
            <p className={helpClass}>Up to six plain-text badges. Enabling a badge confirms that its claim is accurate for your store.</p>
            {cartIntelligence.trustBadges.items.map((item, index) => (
              <div key={item.id} className="grid items-end gap-3 rounded-lg border border-gray-200 bg-white p-3 md:grid-cols-[1fr_2fr_7rem_auto]">
                <input type="hidden" name={`trustBadgeId${index}`} value={item.id} />
                <label className="grid gap-2 text-sm font-medium"><span>Icon</span><select className="rounded-lg border border-gray-300 px-3 py-2" name={`trustBadgeIcon${index}`} defaultValue={item.icon}><option value="secure-payment">Secure payment</option><option value="delivery">Delivery</option><option value="exchange">Exchange</option><option value="cod">Cash on delivery</option><option value="support">Support</option><option value="authenticity">Authenticity</option><option value="custom">General</option></select></label>
                <Field label={`Badge ${index + 1} label`} name={`trustBadgeLabel${index}`} defaultValue={item.label} />
                <Field label="Order" name={`trustBadgeSortOrder${index}`} type="number" defaultValue={String(item.sortOrder)} />
                <Check label="Enabled" name={`trustBadgeEnabled${index}`} defaultChecked={item.enabled} />
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Goal Name" name="goalName" defaultValue={cartIntelligence.cartGoalProgress.goalName} />
            <Field label="Goal Target Amount" name="targetAmount" type="number" defaultValue={cartIntelligence.cartGoalProgress.targetAmountMinor == null ? "" : String(cartIntelligence.cartGoalProgress.targetAmountMinor / 100)} help="Storefront display amount in the store currency." />
            <Field label="Progress Message" name="progressText" defaultValue={cartIntelligence.cartGoalProgress.progressText} help="Use {amount} for the formatted remaining amount." />
            <Field label="Unlocked Message" name="unlockedText" defaultValue={cartIntelligence.cartGoalProgress.unlockedText} />
            <Check label="Hide After Unlock" name="hideAfterUnlock" defaultChecked={cartIntelligence.cartGoalProgress.hideAfterUnlock} help="Hide the goal after the subtotal reaches the target." />
            <Field label="Dynamic Banner Text" name="dynamicBannerText" defaultValue={cartIntelligence.dynamicBannerText} help="Public copy for a future cart banner." />
          </div>
          <div className="grid gap-4 rounded-xl border border-gray-200 bg-white p-4">
            <div>
              <h3 className="font-semibold text-gray-950">Cart Drawer Modules</h3>
              <p className={helpClass}>Module ordering controls optional cart sections only. Core cart items, totals and checkout remain fixed for safety.</p>
            </div>
            <div className="hidden grid-cols-[2fr_1fr_2fr_7rem] gap-3 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
              <span>Module</span><span>Enabled</span><span>Placement</span><span>Order</span>
            </div>
            {configurableCartModules.map(({ key, label }) => {
              const configuredModule = cartIntelligence.cartDrawerModules.modules.find((candidate) => candidate.key === key);
              return (
                <div key={key} className="grid items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[2fr_1fr_2fr_7rem]">
                  <strong className="text-sm text-gray-900">{label}</strong>
                  <Check label="Enabled" name={`cartDrawerModuleEnabled:${key}`} defaultChecked={configuredModule?.enabled === true} />
                  <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Placement</span><select className="rounded-lg border border-gray-300 bg-white px-3 py-2" name={`cartDrawerModuleSlot:${key}`} defaultValue={configuredModule?.slot || "AFTER_CHECKOUT"}>{CART_DRAWER_MODULE_SLOTS.map((slot) => <option key={slot} value={slot}>{slot.replaceAll("_", " ").toLowerCase()}</option>)}</select></label>
                  <Field label="Order" name={`cartDrawerModuleOrder:${key}`} type="number" defaultValue={String(configuredModule?.sortOrder ?? 100)} />
                </div>
              );
            })}
          </div>
        </section>

        <section id="razorpay" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Razorpay" description="Merchant-level Razorpay configuration only. This does not change checkout payment execution, order creation, OTP, cart, Delhivery, analytics, or storefront business logic." />
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Razorpay Enabled" name="razorpayEnabled" defaultChecked={razorpay.enabled} help="Enables Razorpay as a configured merchant payment provider for backend services." />
            <Check label="UPI Enabled" name="razorpayUpiEnabled" defaultChecked={razorpay.upiEnabled} help="Payment method toggles are merchant defaults for future server-side payment flows." />
            <Check label="Cards Enabled" name="razorpayCardsEnabled" defaultChecked={razorpay.cardsEnabled} help="Payment method toggles are merchant defaults only." />
            <Check label="Net Banking Enabled" name="razorpayNetBankingEnabled" defaultChecked={razorpay.netBankingEnabled} help="Payment method toggles are merchant defaults only." />
            <Check label="Wallets Enabled" name="razorpayWalletsEnabled" defaultChecked={razorpay.walletsEnabled} help="Payment method toggles are merchant defaults only." />
            <Check label="COD Fallback Enabled" name="razorpayCodFallbackEnabled" defaultChecked={razorpay.codFallbackEnabled} help="Allows backend flows to know whether COD fallback is allowed by default; no checkout behavior changes are made here." />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-gray-800">
              <span>Environment</span>
              <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10" name="razorpayEnvironment" defaultValue={razorpay.environment}>
                <option value="test">Test</option>
                <option value="production">Production</option>
              </select>
              <span className={helpClass}>Test mode uses Razorpay test credentials. Production mode should use live merchant credentials.</span>
            </label>
            <label className="grid gap-2 text-sm font-medium text-gray-800">
              <span>Capture Mode</span>
              <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10" name="razorpayCaptureMode" defaultValue={razorpay.captureMode}>
                <option value="automatic">Automatic</option>
                <option value="manual">Manual</option>
              </select>
              <span className={helpClass}>Capture mode is stored as a merchant default for backend payment services.</span>
            </label>
            <Field label="Key ID" name="razorpayKeyId" defaultValue={razorpay.keyId} help="Public Razorpay Key ID may be exposed in safe runtime config when needed." />
            <Field label="Currency" name="razorpayCurrency" defaultValue={razorpay.currency} placeholder="INR" help="Three-letter currency code, such as INR." />
            <Field label="Key Secret" name="razorpayKeySecret" type="password" defaultValue={razorpay.keySecretMasked} help="Key Secret is stored securely, masked after save, backend-only, and can be replaced by entering a new value." />
            <Field label="Webhook Secret" name="razorpayWebhookSecret" type="password" defaultValue={razorpay.webhookSecretMasked} help="Webhook Secret is stored securely for backend webhook verification only and is never exposed to storefront runtime config." />
          </div>
        </section>

        <section id="delhivery" className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Delhivery" description="Merchant-level Delhivery configuration only. This does not change checkout, payment, order, or cart behavior." />
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Delhivery Enabled" name="delhiveryEnabled" defaultChecked={delhivery.enabled} help="Enables Delhivery as a configured merchant integration for backend use." />
            <Check label="Pincode Serviceability Check Enabled" name="delhiveryServiceabilityCheckEnabled" defaultChecked={delhivery.serviceabilityCheckEnabled} help="Serviceability controls pincode validation when a backend flow chooses to use Delhivery checks." />
            <Check label="COD Enabled" name="delhiveryCodEnabled" defaultChecked={delhivery.codEnabled} help="COD toggle is a merchant-level default only; no payment behavior changes are made here." />
            <Check label="Prepaid Enabled" name="delhiveryPrepaidEnabled" defaultChecked={delhivery.prepaidEnabled} help="Prepaid toggle is a merchant-level default only; no checkout behavior changes are made here." />
          </div>
          <label className="grid gap-2 text-sm font-medium text-gray-800">
            <span>Environment</span>
            <select className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10" name="delhiveryEnvironment" defaultValue={delhivery.environment}>
              <option value="test">Test</option>
              <option value="production">Production</option>
            </select>
            <span className={helpClass}>Test/production controls which Delhivery endpoint is used by server-side Delhivery integrations.</span>
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="API Token" name="delhiveryApiToken" type="password" defaultValue={delhivery.apiTokenMasked} help="The token is stored securely, masked after save, and can be replaced by entering a new token." />
            <Field label="Pickup Location / Warehouse Name" name="delhiveryPickupLocation" defaultValue={delhivery.pickupLocation} help="Delhivery pickup location or warehouse name configured for this merchant." />
            <Field label="Origin Pincode" name="delhiveryOriginPincode" defaultValue={delhivery.originPincode} help="6-digit origin pincode used as the merchant-level Delhivery origin." />
            <Field label="Default Package Weight" name="delhiveryDefaultPackageWeight" type="number" defaultValue={String(delhivery.defaultPackageWeight)} help="Default package weight used by backend shipping services when needed." />
            <Field label="Default Length" name="delhiveryDefaultLength" type="number" defaultValue={String(delhivery.defaultLength)} help="Default package length." />
            <Field label="Default Breadth" name="delhiveryDefaultBreadth" type="number" defaultValue={String(delhivery.defaultBreadth)} help="Default package breadth." />
            <Field label="Default Height" name="delhiveryDefaultHeight" type="number" defaultValue={String(delhivery.defaultHeight)} help="Default package height." />
          </div>
        </section>
        <section className="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 md:grid-cols-2">
          <div>
            <h2 className="font-semibold text-gray-950">Integrations placeholder</h2>
            <p className="mt-2">Razorpay status: {razorpay.enabled ? "configured" : settings.integrations.razorpay.status}</p>
            <p>Delhivery status: {settings.integrations.delhivery.status}</p>
          </div>
          <div>
            <h2 className="font-semibold text-gray-950">Analytics placeholder</h2>
            <p className="mt-2">Enabled: {settings.analytics.enabled ? "Yes" : "No"}</p>
          </div>
        </section>
        <div className="sticky bottom-4 flex flex-wrap items-center justify-end gap-3 rounded-2xl border border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <button className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800" type="reset">
            Reset unsaved changes
          </button>
          <button className="rounded-lg bg-gray-900 px-5 py-2 font-medium text-white shadow-sm hover:bg-gray-800" type="submit">
            Save Merchant Settings
          </button>
        </div>
      </form>
    </main>
  );
}
