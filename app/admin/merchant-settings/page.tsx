import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  getLoopDeskMerchantSettings,
  updateLoopDeskMerchantSettings,
} from "../../../services/loopdesk/merchant-settings";
import { resolveShopConfig } from "../../../services/shopify/shop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<{ shop?: string; saved?: string }> };

async function saveMerchantSettings(formData: FormData) {
  "use server";
  const shopDomain = String(formData.get("shop") || "");
  const resolved = await resolveShopConfig(shopDomain);
  if (!resolved.id) throw new Error("Unable to resolve shop");
  await updateLoopDeskMerchantSettings(resolved.id, {
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
  revalidatePath("/admin/merchant-settings");
  redirect(
    `/admin/merchant-settings?shop=${encodeURIComponent(resolved.shopDomain)}&saved=1`,
  );
}

function Field(props: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium text-gray-700">
      {props.label}
      <input
        className="rounded border border-gray-300 px-3 py-2"
        name={props.name}
        type={props.type || "text"}
        defaultValue={props.defaultValue || ""}
      />
    </label>
  );
}
function Check(props: {
  label: string;
  name: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        name={props.name}
        type="checkbox"
        defaultChecked={props.defaultChecked}
      />
      {props.label}
    </label>
  );
}

export default async function MerchantSettingsPage({
  searchParams,
}: PageProps) {
  const params = searchParams ? await searchParams : {};
  const resolved = await resolveShopConfig(params.shop);
  if (!resolved.id)
    return (
      <main className="p-8">
        <h1 className="text-xl font-semibold">Merchant Settings</h1>
        <p>Unable to resolve shop.</p>
      </main>
    );
  const settings = await getLoopDeskMerchantSettings(resolved.id);
  return (
    <main className="mx-auto max-w-5xl p-8">
      <h1 className="text-2xl font-semibold">Merchant Settings</h1>
      <p className="mt-2 text-sm text-gray-600">
        Manage the LoopDesk storefront runtime config persisted in
        ShopModuleConfig / loopdesk_runtime_config. Razorpay, Delhivery, and
        analytics values are read-only placeholders and no secrets are exposed.
      </p>
      {params.saved === "1" ? (
        <div className="mt-4 rounded border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-800">
          Merchant settings saved. The storefront runtime config endpoint now
          reflects these values.
        </div>
      ) : null}
      <form action={saveMerchantSettings} className="mt-6 grid gap-6">
        <input type="hidden" name="shop" value={resolved.shopDomain} />
        <section className="grid gap-3 rounded border p-4">
          <h2 className="font-semibold">General</h2>
          <Field
            label="Merchant name"
            name="merchantName"
            defaultValue={settings.general.merchantName}
          />
          <Field
            label="Support email"
            name="supportEmail"
            defaultValue={settings.general.supportEmail}
          />
          <Field
            label="Support phone"
            name="supportPhone"
            defaultValue={settings.general.supportPhone}
          />
          <Field
            label="Support WhatsApp"
            name="supportWhatsApp"
            defaultValue={settings.general.supportWhatsApp}
          />
        </section>
        <section className="grid gap-3 rounded border p-4">
          <h2 className="font-semibold">Branding</h2>
          <Field
            label="Logo URL"
            name="logoUrl"
            defaultValue={settings.branding.logoUrl}
          />
          <Field
            label="Primary color"
            name="primaryColor"
            defaultValue={settings.branding.primaryColor}
          />
          <Field
            label="Secondary color"
            name="secondaryColor"
            defaultValue={settings.branding.secondaryColor}
          />
          <Field
            label="Accent color"
            name="accentColor"
            defaultValue={settings.branding.accentColor}
          />
          <Field
            label="Border radius"
            name="borderRadius"
            defaultValue={settings.branding.borderRadius}
          />
          <Check
            label="Show Powered by"
            name="showPoweredBy"
            defaultChecked={settings.branding.showPoweredBy}
          />
          <Field
            label="Powered by text"
            name="poweredByText"
            defaultValue={settings.branding.poweredByText}
          />
        </section>
        <section className="grid gap-3 rounded border p-4">
          <h2 className="font-semibold">Labels</h2>
          <Field
            label="Express checkout text"
            name="expressCheckoutText"
            defaultValue={settings.labels.expressCheckoutText}
          />
          <Field
            label="View cart text"
            name="viewCartText"
            defaultValue={settings.labels.viewCartText}
          />
          <Field
            label="Secure checkout text"
            name="secureCheckoutText"
            defaultValue={settings.labels.secureCheckoutText}
          />
        </section>
        <section className="grid gap-3 rounded border p-4">
          <h2 className="font-semibold">Cart</h2>
          <label className="grid gap-1 text-sm font-medium text-gray-700">
            Drawer mode
            <select
              className="rounded border border-gray-300 px-3 py-2"
              name="drawerMode"
              defaultValue={settings.cart.drawerMode}
            >
              <option value="auto">Auto</option>
              <option value="loopdesk">LoopDesk Enhanced Drawer</option>
              <option value="theme">Theme drawer</option>
            </select>
          </label>
          <p className="text-sm text-amber-700">
            To use LoopDesk Enhanced Drawer, set your Shopify theme cart
            type/cart style to Page.
          </p>
          <Check
            label="Open after add to cart"
            name="openAfterAddToCart"
            defaultChecked={settings.cart.openAfterAddToCart}
          />
          <Check
            label="Express checkout button enabled"
            name="expressCheckoutButtonEnabled"
            defaultChecked={settings.cart.expressCheckoutButtonEnabled}
          />
          <Check
            label="View cart button enabled"
            name="viewCartButtonEnabled"
            defaultChecked={settings.cart.viewCartButtonEnabled}
          />
        </section>
        <section className="grid gap-3 rounded border p-4">
          <h2 className="font-semibold">Checkout</h2>
          <Check
            label="Show secure badge"
            name="showSecureBadge"
            defaultChecked={settings.checkout.showSecureBadge}
          />
          <Check
            label="Show trust copy"
            name="showTrustCopy"
            defaultChecked={settings.checkout.showTrustCopy}
          />
        </section>
        <section className="grid gap-2 rounded border bg-gray-50 p-4">
          <h2 className="font-semibold">Integrations placeholder</h2>
          <p>Razorpay status: {settings.integrations.razorpay.status}</p>
          <p>Delhivery status: {settings.integrations.delhivery.status}</p>
        </section>
        <section className="grid gap-2 rounded border bg-gray-50 p-4">
          <h2 className="font-semibold">Analytics placeholder</h2>
          <p>Enabled: {settings.analytics.enabled ? "Yes" : "No"}</p>
        </section>
        <button
          className="rounded bg-gray-900 px-4 py-2 font-medium text-white"
          type="submit"
        >
          Save Merchant Settings
        </button>
      </form>
    </main>
  );
}
