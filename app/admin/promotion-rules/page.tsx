import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getPromotionRulesConfig, normalizePromotionRule, PROMOTION_RULES_CONFIG_MODULE_KEY, savePromotionRulesConfig, type PromotionConflictStrategy, type PromotionResourceMetadata } from "../../../services/promotion-rules/config";
import { ResourcePickerFields } from "./ResourcePickerFields";
import { formatAdminShopResolutionError, resolveAdminShopFromSearchParams } from "../../../services/shopify/admin-shop-context";
import { embeddedContextFromFormData, embeddedContextHiddenInputs, withEmbeddedContext, type EmbeddedSearchParams } from "./embedded-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PageProps = { searchParams?: Promise<EmbeddedSearchParams & { shop?: string; rule?: string; saved?: string; error?: string; host?: string }> };
const cardClass = "rounded-2xl border border-gray-200 bg-white p-6 shadow-sm";
const inputClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10";
const helpClass = "text-xs leading-5 text-gray-500";

function getString(formData: FormData, key: string) { return String(formData.get(key) || ""); }
function getBool(formData: FormData, key: string) { return formData.get(key) === "on"; }

async function savePromotionRules(shopId: string, shopDomain: string, formData: FormData) {
  "use server";
  const rawIntent = getString(formData, "intent");
  const [intent, intentRuleId] = rawIntent.split(":");
  const ruleId = intentRuleId || getString(formData, "ruleId");
  const embeddedContext = embeddedContextFromFormData(formData);
  embeddedContext.set("shop", shopDomain);
  embeddedContext.set("saved", "1");
  let redirectUrl = `/admin/promotion-rules?${embeddedContext.toString()}`;
  try {
    const current = await getPromotionRulesConfig(shopId);
    const base = { ...current, enabled: getBool(formData, "moduleEnabled"), maxVisibleOffers: Number(getString(formData, "maxVisibleOffers")), conflictStrategy: getString(formData, "conflictStrategy") };
    let rules = [...current.rules];
    if (intent === "delete") rules = rules.filter((rule) => rule.id !== ruleId);
    if (intent === "archive") rules = rules.map((rule) => rule.id === ruleId ? { ...rule, enabled: false, status: "archived" as const } : rule);
    if (intent === "pause") rules = rules.map((rule) => rule.id === ruleId ? { ...rule, enabled: false, status: "paused" as const } : rule);
    if (intent === "toggle") rules = rules.map((rule) => rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule);
    if (intent === "upsert") {
      const rule = normalizePromotionRule({
        id: ruleId,
        name: getString(formData, "name"),
        enabled: getBool(formData, "enabled"),
        status: getString(formData, "status"),
        priority: getString(formData, "priority"),
        eligibility: { match: getString(formData, "match"), triggers: [{ type: getString(formData, "triggerType"), value: getString(formData, "triggerType") === "cart_contains_product" ? getString(formData, "triggerProductGid") : getString(formData, "triggerType") === "cart_contains_collection" ? getString(formData, "triggerCollectionGid") : getString(formData, "triggerType") === "cart_contains_variant" ? getString(formData, "triggerVariantGid") : getString(formData, "triggerValueText"), productGid: getString(formData, "triggerProductGid"), collectionGid: getString(formData, "triggerCollectionGid"), variantGid: getString(formData, "triggerVariantGid"), product: { id: getString(formData, "triggerProductGid"), gid: getString(formData, "triggerProductGid"), title: getString(formData, "triggerProductTitle"), image: getString(formData, "triggerProductImageUrl"), imageUrl: getString(formData, "triggerProductImageUrl"), handle: getString(formData, "triggerProductHandle"), resourceType: "product" }, collection: { id: getString(formData, "triggerCollectionGid"), gid: getString(formData, "triggerCollectionGid"), title: getString(formData, "triggerCollectionTitle"), image: getString(formData, "triggerCollectionImageUrl"), imageUrl: getString(formData, "triggerCollectionImageUrl"), handle: getString(formData, "triggerCollectionHandle"), resourceType: "collection" }, variant: { id: getString(formData, "triggerVariantGid"), gid: getString(formData, "triggerVariantGid"), title: getString(formData, "triggerVariantTitle"), image: getString(formData, "triggerVariantImageUrl"), imageUrl: getString(formData, "triggerVariantImageUrl"), handle: getString(formData, "triggerVariantHandle"), resourceType: "variant" } }] },
        reward: { type: "offer_product", productGid: getString(formData, "offerProductGid"), variantGid: getString(formData, "offerVariantGid"), quantity: getString(formData, "quantity"), requiresDiscountEnforcement: getBool(formData, "requiresDiscountEnforcement"), product: { id: getString(formData, "offerProductGid"), gid: getString(formData, "offerProductGid"), title: getString(formData, "offerProductTitle"), image: getString(formData, "offerProductImageUrl"), imageUrl: getString(formData, "offerProductImageUrl"), handle: getString(formData, "offerProductHandle"), resourceType: "product", variantGid: getString(formData, "offerVariantGid"), variantTitle: getString(formData, "offerVariantTitle") } },
        display: { heading: getString(formData, "heading"), description: getString(formData, "description"), badge: getString(formData, "badge"), ctaLabel: getString(formData, "ctaLabel"), imageOverrideUrl: getString(formData, "imageOverrideUrl"), offerPriceDisplay: getString(formData, "offerPriceDisplay"), comparePriceDisplay: getString(formData, "comparePriceDisplay"), placement: getString(formData, "placement"), hideIfOfferProductAlreadyInCart: getBool(formData, "hideIfOfferProductAlreadyInCart") },
        limits: { maxQuantityPerCart: getString(formData, "maxQuantityPerCart"), showOncePerSession: getBool(formData, "showOncePerSession") },
        schedule: { alwaysActive: getBool(formData, "alwaysActive"), startAt: getString(formData, "startAt"), endAt: getString(formData, "endAt"), timezone: getString(formData, "timezone") },
      });
      rules = rules.some((existing) => existing.id === rule.id) ? rules.map((existing) => existing.id === rule.id ? rule : existing) : [...rules, rule];
      embeddedContext.set("rule", rule.id);
      redirectUrl = `/admin/promotion-rules?${embeddedContext.toString()}`;
    }
    const saved = await savePromotionRulesConfig(shopId, { ...base, schemaVersion: 1, enabled: base.enabled, maxVisibleOffers: Number(base.maxVisibleOffers), conflictStrategy: base.conflictStrategy as PromotionConflictStrategy, rules });
    console.info("[Promotion Admin Save]", {
      shopId,
      shopDomain,
      moduleKey: PROMOTION_RULES_CONFIG_MODULE_KEY,
      enabled: saved.enabled,
      ruleCount: saved.rules.length,
    });
    revalidatePath("/admin/promotion-rules");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid promotion rules configuration.";
    embeddedContext.delete("saved");
    embeddedContext.set("error", message);
    if (ruleId) embeddedContext.set("rule", ruleId);
    redirectUrl = `/admin/promotion-rules?${embeddedContext.toString()}`;
  }
  redirect(redirectUrl);
}

function Field({ label, name, defaultValue, type = "text", help }: { label: string; name: string; defaultValue?: string | number | null; type?: string; help?: string }) {
  return <label className="grid gap-2 text-sm font-medium text-gray-800"><span>{label}</span><input className={inputClass} name={name} type={type} defaultValue={defaultValue ?? ""} />{help ? <span className={helpClass}>{help}</span> : null}</label>;
}
function Check({ label, name, defaultChecked, help }: { label: string; name: string; defaultChecked: boolean; help?: string }) {
  return <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-800"><input className="mt-1" name={name} type="checkbox" defaultChecked={defaultChecked} /><span><span className="font-medium">{label}</span>{help ? <span className={`block ${helpClass}`}>{help}</span> : null}</span></label>;
}
function Select({ label, name, defaultValue, children }: { label: string; name: string; defaultValue: string; children: React.ReactNode }) { return <label className="grid gap-2 text-sm font-medium text-gray-800"><span>{label}</span><select className={inputClass} name={name} defaultValue={defaultValue}>{children}</select></label>; }

export default async function PromotionRulesPage({ searchParams }: PageProps) {
  const params = searchParams ? await searchParams : {};
  const resolved = await resolveAdminShopFromSearchParams(params);
  if (!resolved.shop?.id) return <main className="mx-auto max-w-3xl p-8"><div className={cardClass}><h1 className="text-2xl font-semibold">Promotion Rules</h1><p className="mt-3 text-sm text-red-700">{params.error || formatAdminShopResolutionError(resolved)}</p></div></main>;
  const shop = resolved.shop;
  const config = await getPromotionRulesConfig(shop.id, shop.shopDomain);
  const createRuleHref = withEmbeddedContext("/admin/promotion-rules", params, { shop: shop.shopDomain, rule: null, saved: null, error: null });
  const selected = config.rules.find((rule) => rule.id === params.rule) || normalizePromotionRule({ id: "new_rule", name: "", display: { ctaLabel: "Add offer" } });
  const action = savePromotionRules.bind(null, shop.id, shop.shopDomain);
  const trigger = selected.eligibility.triggers[0];
  const emptyResource: PromotionResourceMetadata = { id: "", gid: "", title: "", image: "", imageUrl: "", handle: "" };
  const triggerProduct = trigger.product || { ...emptyResource, gid: trigger.productGid || "" };
  const triggerCollection = trigger.collection || { ...emptyResource, gid: trigger.collectionGid || "" };
  const triggerVariant = (trigger as typeof trigger & { variant?: PromotionResourceMetadata; variantGid?: string }).variant || { ...emptyResource, gid: (trigger as typeof trigger & { variantGid?: string }).variantGid || "", resourceType: "variant" as const };
  const offerProduct = selected.reward.product || { ...emptyResource, gid: selected.reward.productGid, resourceType: "product" as const, variantGid: selected.reward.variantGid };
  return <main className="mx-auto max-w-6xl px-6 py-8">
    <div className="mb-6 rounded-2xl bg-gray-950 p-6 text-white shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-gray-300">Cart Intelligence / Promotion Rules</p><h1 className="mt-2 text-3xl font-semibold">Promotion Rules</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-gray-200">Configure display-only offer rules for {shop.shopDomain}. Saves to ShopModuleConfig moduleKey {PROMOTION_RULES_CONFIG_MODULE_KEY}; no drawer, checkout, cart mutation, analytics, payment, order, or discount-enforcement behavior is changed.</p></div>
    {params.saved ? <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm font-medium text-green-800">Promotion Rules configuration saved.</div> : null}
    {params.error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-800">{params.error}</div> : null}
    <form action={action} className="grid gap-6">
      {embeddedContextHiddenInputs(params).map(([key, value]) => <input key={key} type="hidden" name={`embeddedContext:${key}`} value={value} />)}
      <section className={`${cardClass} grid gap-5`}><h2 className="text-lg font-semibold text-gray-950">Module settings</h2><div className="grid gap-4 md:grid-cols-3"><Check label="Module enabled" name="moduleEnabled" defaultChecked={config.enabled} help="Admin persistence only in this phase." /><Field label="Max visible offers" name="maxVisibleOffers" type="number" defaultValue={config.maxVisibleOffers} /><Select label="Conflict strategy" name="conflictStrategy" defaultValue={config.conflictStrategy}><option value="priority_first">Priority first</option><option value="newest_first">Newest first</option><option value="oldest_first">Oldest first</option></Select></div></section>
      <section className={`${cardClass} grid gap-4`}><div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-950">Rules list</h2><a className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium" href={createRuleHref}>Create rule</a></div><div className="grid gap-3">{config.rules.length ? config.rules.map((rule) => <div key={rule.id} className="grid gap-3 rounded-xl border border-gray-200 p-4 md:grid-cols-[1fr_auto]"><div><p className="font-semibold text-gray-950">{rule.name}</p><p className="mt-1 text-sm text-gray-600">Status: {rule.status}. Enabled: {rule.enabled ? "Yes" : "No"}. Priority: {rule.priority}. Trigger: {rule.eligibility.triggers[0]?.type}. Offer: {rule.reward.productGid || "missing"}. Placement: {rule.display.placement}.</p></div><div className="flex flex-wrap gap-2"><a className="rounded-lg border px-3 py-2 text-sm" href={withEmbeddedContext("/admin/promotion-rules", params, { shop: shop.shopDomain, rule: rule.id, saved: null, error: null })}>Edit</a><button className="rounded-lg border px-3 py-2 text-sm" name="intent" value={`toggle:${rule.id}`}>{rule.enabled ? "Disable" : "Enable"}</button><button className="rounded-lg border px-3 py-2 text-sm" name="intent" value={`pause:${rule.id}`}>Pause</button><button className="rounded-lg border px-3 py-2 text-sm" name="intent" value={`archive:${rule.id}`}>Archive</button><button className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700" name="intent" value={`delete:${rule.id}`}>Delete</button></div></div>) : <p className="text-sm text-gray-600">No rules configured yet.</p>}</div></section>
      <input type="hidden" name="ruleId" value={selected.id} />
      <section className={`${cardClass} grid gap-5`}><h2 className="text-lg font-semibold text-gray-950">{config.rules.some((rule) => rule.id === selected.id) ? "Edit rule" : "Create rule"}</h2><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-900">Display price is not yet enforced as a real checkout discount. Discount enforcement will be added in a later Shopify-safe phase. Hidden discounted products are not recommended. Offer product must be available in storefront for runtime display later.</div>
        <div className="grid gap-4 md:grid-cols-4"><Field label="Rule name" name="name" defaultValue={selected.name} /><Check label="Enabled" name="enabled" defaultChecked={selected.enabled} /><Select label="Status" name="status" defaultValue={selected.status}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></Select><Field label="Priority" name="priority" type="number" defaultValue={selected.priority} /></div>
        <div className="grid gap-4 md:grid-cols-3"><Select label="Match mode" name="match" defaultValue={selected.eligibility.match}><option value="all">All</option><option value="any">Any</option></Select></div>
        <ResourcePickerFields triggerType={trigger.type} triggerValue={trigger.value || ""} triggerProduct={triggerProduct} triggerCollection={triggerCollection} triggerVariant={triggerVariant} offerProduct={offerProduct} shopPresent={Boolean(params.shop || params.shopify_shop)} hostPresent={Boolean(params.host)} />
        <details className="rounded-xl border border-gray-200 bg-gray-50 p-4"><summary className="cursor-pointer text-sm font-semibold text-gray-800">Advanced/debug raw Shopify IDs</summary><div className="mt-4 grid gap-4 md:grid-cols-3"><Field label="Trigger raw value" name="triggerValueRaw" defaultValue={trigger.value || ""} /><Field label="Offer product GID / ID" name="offerProductGidRaw" defaultValue={selected.reward.productGid} /><Field label="Offer variant GID / ID" name="offerVariantGidRaw" defaultValue={selected.reward.variantGid} /></div></details>
        <div className="grid gap-4 md:grid-cols-3"><Field label="Quantity" name="quantity" type="number" defaultValue={selected.reward.quantity} /><Field label="Display price" name="offerPriceDisplay" defaultValue={selected.display.offerPriceDisplay} help="Merchant-defined storefront copy, for example ₹150." /><Field label="Compare price" name="comparePriceDisplay" defaultValue={selected.display.comparePriceDisplay} help="Original/current selling price copy, for example ₹280." /><Check label="Requires discount enforcement warning" name="requiresDiscountEnforcement" defaultChecked={selected.reward.requiresDiscountEnforcement} /></div>
        <div className="grid gap-4 md:grid-cols-3"><Field label="Heading" name="heading" defaultValue={selected.display.heading} /><Field label="Description" name="description" defaultValue={selected.display.description} /><Field label="Badge" name="badge" defaultValue={selected.display.badge} /><Field label="CTA label" name="ctaLabel" defaultValue={selected.display.ctaLabel} /><Field label="Image override URL" name="imageOverrideUrl" defaultValue={selected.display.imageOverrideUrl} /><Select label="Placement" name="placement" defaultValue={selected.display.placement}><option value="drawer">Drawer</option><option value="cart_page">Cart page</option><option value="both">Both</option></Select><Check label="Hide if offer product already in cart" name="hideIfOfferProductAlreadyInCart" defaultChecked={selected.display.hideIfOfferProductAlreadyInCart} /></div>
        <div className="grid gap-4 md:grid-cols-4"><Field label="Max quantity per cart" name="maxQuantityPerCart" type="number" defaultValue={selected.limits.maxQuantityPerCart} /><Check label="Show once per session" name="showOncePerSession" defaultChecked={selected.limits.showOncePerSession} /><Check label="Always active" name="alwaysActive" defaultChecked={selected.schedule.alwaysActive} /><Field label="Timezone" name="timezone" defaultValue={selected.schedule.timezone} /><Field label="Start date/time" name="startAt" type="datetime-local" defaultValue={selected.schedule.startAt} /><Field label="End date/time" name="endAt" type="datetime-local" defaultValue={selected.schedule.endAt} /></div>
        <button className="justify-self-end rounded-lg bg-gray-900 px-5 py-2 font-medium text-white" name="intent" value="upsert" type="submit">Save rule and module settings</button>
      </section>
    </form>
  </main>;
}
