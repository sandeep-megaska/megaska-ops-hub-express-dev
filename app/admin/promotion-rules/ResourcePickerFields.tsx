"use client";

import { useEffect, useMemo, useState } from "react";
import { getStoredShopifyHost } from "../../ShopifyHostContext";

type ResourceMeta = { gid: string; title: string; imageUrl: string | null; handle: string; variantGid?: string; variantTitle?: string };
type ShopifyPickerVariant = { id?: string; title?: string; displayName?: string; image?: { url?: string; originalSrc?: string } };
type ShopifyPickerResource = { id?: string; title?: string; handle?: string; image?: { url?: string; originalSrc?: string; altText?: string }; images?: Array<{ url?: string; originalSrc?: string }>; variants?: ShopifyPickerVariant[] };

type ShopifyGlobal = { resourcePicker?: (options: Record<string, unknown>) => Promise<ShopifyPickerResource[] | ShopifyPickerResource | undefined> };

declare global { interface Window { shopify?: ShopifyGlobal; app?: ShopifyGlobal } }

const inputClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10";
const helpClass = "text-xs leading-5 text-gray-500";

function firstImage(resource?: ShopifyPickerResource) { return resource?.image?.url || resource?.image?.originalSrc || resource?.images?.[0]?.url || resource?.images?.[0]?.originalSrc || ""; }
function normalizePicked(resource?: ShopifyPickerResource): ResourceMeta { return { gid: resource?.id || "", title: resource?.title || "", imageUrl: firstImage(resource), handle: resource?.handle || "" }; }
function normalizeVariant(variant?: ShopifyPickerVariant) { return { gid: variant?.id || "", title: variant?.title || variant?.displayName || "", imageUrl: variant?.image?.url || variant?.image?.originalSrc || "" }; }
function firstPicked(result: ShopifyPickerResource[] | ShopifyPickerResource | undefined) { return Array.isArray(result) ? result[0] : result; }
function getPicker() {
  if (typeof window === "undefined") return undefined;
  return window.shopify?.resourcePicker || window.app?.resourcePicker;
}
function hasAppBridgeGlobal() {
  if (typeof window === "undefined") return false;
  return Boolean(window.shopify || window.app);
}

function ResourceSummary({ meta, fallbackLabel }: { meta: ResourceMeta; fallbackLabel: string }) {
  const title = meta.title || (meta.gid ? `${fallbackLabel} selected` : `No ${fallbackLabel.toLowerCase()} selected`);
  return <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
    {meta.imageUrl ? <img src={meta.imageUrl} alt="" className="h-14 w-14 rounded-lg border border-gray-200 object-cover" /> : <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-gray-300 bg-white text-xs text-gray-400">No image</div>}
    <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-950">{title}</p>{meta.handle ? <p className={helpClass}>/{meta.handle}</p> : null}{meta.variantTitle ? <p className={helpClass}>Variant: {meta.variantTitle}</p> : null}</div>
  </div>;
}

export function ResourcePickerFields({ triggerType: initialTriggerType, triggerValue, triggerProduct, triggerCollection, offerProduct, shopPresent, hostPresent }: { triggerType: string; triggerValue: string; triggerProduct: ResourceMeta; triggerCollection: ResourceMeta; offerProduct: ResourceMeta; shopPresent: boolean; hostPresent: boolean }) {
  const [pickerError, setPickerError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [appBridgeReady, setAppBridgeReady] = useState(false);
  const [resourcePickerReady, setResourcePickerReady] = useState(false);
  const [runtimeHostPresent, setRuntimeHostPresent] = useState(hostPresent);
  const [storedHostPresent, setStoredHostPresent] = useState(false);
  const [triggerType, setTriggerType] = useState(initialTriggerType);
  const [triggerText, setTriggerText] = useState(triggerValue);
  const [product, setProduct] = useState<ResourceMeta>({ ...triggerProduct, gid: triggerProduct.gid || (triggerType === "cart_contains_product" ? triggerValue : "") });
  const [collection, setCollection] = useState<ResourceMeta>({ ...triggerCollection, gid: triggerCollection.gid || (triggerType === "cart_contains_collection" ? triggerValue : "") });
  const [offer, setOffer] = useState<ResourceMeta>(offerProduct);
  const [variants, setVariants] = useState<Array<{ gid: string; title: string; imageUrl: string }>>([]);
  const triggerPickerValue = triggerType === "cart_contains_product" ? product.gid : triggerType === "cart_contains_collection" ? collection.gid : triggerText;
  const showTriggerProduct = triggerType === "cart_contains_product";
  const showTriggerCollection = triggerType === "cart_contains_collection";

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      if (cancelled) return;
      setHydrated(true);
      const currentParams = new URLSearchParams(window.location.search);
      const currentShop = String(currentParams.get("shop") || currentParams.get("shopify_shop") || "").trim();
      const hasRuntimeHost = Boolean(String(currentParams.get("host") || "").trim());
      setRuntimeHostPresent(hasRuntimeHost);
      setStoredHostPresent(Boolean(getStoredShopifyHost(currentShop)));
      setAppBridgeReady(hasAppBridgeGlobal() && hasRuntimeHost);
      setResourcePickerReady(Boolean(getPicker()) && hasRuntimeHost);
    }
    const timers = [0, 150, 500, 1200, 2500].map((delay) => window.setTimeout(refresh, delay));
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  async function pick(type: "product" | "collection", purpose: "trigger" | "offer") {
    setPickerError("");
    const picker = getPicker();
    if (!hydrated) { setPickerError("Initializing Shopify Resource Picker. Try again in a moment, or use Advanced raw IDs below."); return; }
    if (!picker) { setPickerError("Shopify Resource Picker is unavailable in this browser context. Open this page inside Shopify Admin, or use Advanced raw IDs below."); return; }
    const picked = firstPicked(await picker({ type, multiple: false, action: "select" }));
    if (!picked?.id) return;
    if (type === "collection") setCollection(normalizePicked(picked));
    if (type === "product" && purpose === "trigger") setProduct(normalizePicked(picked));
    if (type === "product" && purpose === "offer") {
      const nextProduct = normalizePicked(picked);
      const nextVariants = (picked.variants || []).map(normalizeVariant).filter((variant) => variant.gid);
      setVariants(nextVariants);
      const selectedVariant = nextVariants.length === 1 ? nextVariants[0] : nextVariants.find((variant) => variant.gid === offer.variantGid);
      setOffer({ ...nextProduct, variantGid: selectedVariant?.gid || "", variantTitle: selectedVariant?.title || "", imageUrl: nextProduct.imageUrl || selectedVariant?.imageUrl || "" });
    }
  }

  const variantOptions = useMemo(() => variants.length ? variants : offer.variantGid ? [{ gid: offer.variantGid, title: offer.variantTitle || "Selected variant", imageUrl: "" }] : [], [variants, offer.variantGid, offer.variantTitle]);

  return <div className="grid gap-4">
    <input type="hidden" name="triggerType" value={triggerType} />
    <input type="hidden" name="triggerValue" value={triggerPickerValue} />
    <input type="hidden" name="triggerProductGid" value={product.gid} /><input type="hidden" name="triggerProductTitle" value={product.title} /><input type="hidden" name="triggerProductImageUrl" value={product.imageUrl || ""} /><input type="hidden" name="triggerProductHandle" value={product.handle} />
    <input type="hidden" name="triggerCollectionGid" value={collection.gid} /><input type="hidden" name="triggerCollectionTitle" value={collection.title} /><input type="hidden" name="triggerCollectionImageUrl" value={collection.imageUrl || ""} /><input type="hidden" name="triggerCollectionHandle" value={collection.handle} />
    <input type="hidden" name="offerProductGid" value={offer.gid} /><input type="hidden" name="offerProductTitle" value={offer.title} /><input type="hidden" name="offerProductImageUrl" value={offer.imageUrl || ""} /><input type="hidden" name="offerProductHandle" value={offer.handle} /><input type="hidden" name="offerVariantGid" value={offer.variantGid || ""} /><input type="hidden" name="offerVariantTitle" value={offer.variantTitle || ""} />

    <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-gray-800"><span>Trigger type</span><select className={inputClass} value={triggerType} onChange={(event) => setTriggerType(event.target.value)}><option value="always">Always</option><option value="cart_contains_product">Cart contains product</option><option value="cart_contains_collection">Cart contains collection</option><option value="cart_contains_product_type">Cart contains product type</option><option value="cart_contains_tag">Cart contains tag</option><option value="cart_subtotal_gte">Cart subtotal greater than or equal to</option><option value="cart_quantity_gte">Cart quantity greater than or equal to</option></select></label>{!showTriggerProduct && !showTriggerCollection ? <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Trigger value</span><input className={inputClass} name="triggerValueText" value={triggerText} onChange={(event) => setTriggerText(event.target.value)} /><span className={helpClass}>Enter product type, tag, subtotal, or quantity based on trigger type.</span></label> : null}</div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950">Shopify embedded diagnostic: shop present: {shopPresent ? "yes" : "no"}; host present: {runtimeHostPresent ? "yes" : "no"}; stored host present: {storedHostPresent ? "yes" : "no"}; app bridge ready: {appBridgeReady ? "yes" : "no"}; resource picker ready: {resourcePickerReady ? "yes" : "no"}.</div>
    {!hydrated ? <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Initializing Shopify Resource Picker…</div> : !resourcePickerReady ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Shopify Resource Picker is unavailable in this browser context. Open this page inside Shopify Admin, or use Advanced raw IDs below.</div> : null}
    {pickerError ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{pickerError}</div> : null}
    {showTriggerProduct ? <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-950">Trigger product</p><p className={helpClass}>Choose the product customers must have in cart.</p></div><button type="button" onClick={() => pick("product", "trigger")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">Select product</button></div><ResourceSummary meta={product} fallbackLabel="Selected product" /></div> : null}
    {showTriggerCollection ? <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-950">Trigger collection</p><p className={helpClass}>Choose the collection customers must have in cart.</p></div><button type="button" onClick={() => pick("collection", "trigger")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">Select collection</button></div><ResourceSummary meta={collection} fallbackLabel="Selected collection" /></div> : null}
    <div className="grid gap-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold text-gray-950">Offer product</p><p className={helpClass}>Choose the product that this display-only rule will offer.</p></div><button type="button" onClick={() => pick("product", "offer")} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">Select offer product</button></div><ResourceSummary meta={offer} fallbackLabel="Selected product" />{variantOptions.length ? <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Offer variant</span><select className={inputClass} value={offer.variantGid || ""} onChange={(event) => { const variant = variantOptions.find((next) => next.gid === event.target.value); setOffer({ ...offer, variantGid: event.target.value, variantTitle: variant?.title || "" }); }}><option value="">Select variant</option>{variantOptions.map((variant) => <option key={variant.gid} value={variant.gid}>{variant.title || variant.gid}</option>)}</select></label> : <p className={helpClass}>Select an offer product to choose its variant.</p>}</div>
  </div>;
}
