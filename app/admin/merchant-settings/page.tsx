import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getLoopDeskMerchantSettings,
  updateLoopDeskMerchantSettings,
} from "../../../services/loopdesk/merchant-settings";
import { resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<{
    shop?: string;
    shopify_shop?: string;
    host?: string;
    hmac?: string;
    saved?: string;
    error?: string;
  }>;
};

const SHOP_UNRESOLVED_MESSAGE =
  "Unable to resolve shop. Open this page from Shopify admin.";

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

  let redirectUrl = `/admin/merchant-settings?shop=${encodeURIComponent(shopDomain)}&saved=1`;
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
    });
    revalidatePath(`/admin/merchant-settings?shop=${encodeURIComponent(shopDomain)}`);
    revalidatePath("/admin/merchant-settings");
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid merchant settings.";
    redirectUrl = `/admin/merchant-settings?shop=${encodeURIComponent(shopDomain)}&error=${encodeURIComponent(message)}`;
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
            {params.error || resolved.error || SHOP_UNRESOLVED_MESSAGE}
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
  const settings = await getLoopDeskMerchantSettings(resolved.shop.id);
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
          <a className="rounded-lg bg-white/10 px-3 py-2 font-medium hover:bg-white/20" href={`/?shop=${shopParam}`}>
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
        <section className={`${cardClass} grid gap-5`}>
          <SectionHeader title="General" description="Customer-facing store and support details. Keep these short and public-safe." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Merchant name" name="merchantName" defaultValue={settings.general.merchantName} help="Shown in LoopDesk drawer branding." />
            <Field label="Support email" name="supportEmail" type="email" defaultValue={settings.general.supportEmail} help="Optional public support contact." />
            <Field label="Support phone" name="supportPhone" defaultValue={settings.general.supportPhone} help="Optional public support phone." />
            <Field label="Support WhatsApp" name="supportWhatsApp" defaultValue={settings.general.supportWhatsApp} help="Optional public WhatsApp contact." />
          </div>
        </section>
        <section className={`${cardClass} grid gap-5`}>
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
        <section className={`${cardClass} grid gap-5`}>
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
        <section className={`${cardClass} grid gap-5`}>
          <SectionHeader title="Checkout reassurance" description="Non-payment display controls only. Payment, OTP, and order logic are unchanged." />
          <div className="grid gap-3 md:grid-cols-2">
            <Check label="Show secure badge" name="showSecureBadge" defaultChecked={settings.checkout.showSecureBadge} />
            <Check label="Show trust copy" name="showTrustCopy" defaultChecked={settings.checkout.showTrustCopy} />
          </div>
        </section>
        <section className="grid gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-6 text-sm text-gray-700 md:grid-cols-2">
          <div>
            <h2 className="font-semibold text-gray-950">Integrations placeholder</h2>
            <p className="mt-2">Razorpay status: {settings.integrations.razorpay.status}</p>
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
