"use client";

import { useEffect, useMemo, useState } from "react";
import { getStoredShopifyHost } from "../../ShopifyHostContext";
import { extractPickerVariantPrices, type PickerVariantPriceSource } from "../../../services/promotion-rules/resource-picker-price";

type ResourceType = "product" | "collection" | "variant";
type ResourceMeta = { id?: string; gid: string; title: string; image?: string | null; imageUrl: string | null; handle: string; resourceType?: ResourceType; variantGid?: string; variantTitle?: string; variantPrice?: string; variantCompareAtPrice?: string; priceSource?: PickerVariantPriceSource; compareAtPriceSource?: PickerVariantPriceSource };
type ShopifyPickerVariant = { id?: string; title?: string; displayName?: string; handle?: string; image?: { url?: string; originalSrc?: string } };
type ShopifyPickerResource = { id?: string; title?: string; handle?: string; image?: { url?: string; originalSrc?: string; altText?: string }; images?: Array<{ url?: string; originalSrc?: string }>; variants?: ShopifyPickerVariant[] | { nodes?: ShopifyPickerVariant[] }; selectedVariant?: ShopifyPickerVariant; variant?: ShopifyPickerVariant };

const inputClass = "rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-950 shadow-sm outline-none transition focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10";
const helpClass = "text-xs leading-5 text-gray-500";

function firstImage(resource?: ShopifyPickerResource) { return resource?.image?.url || resource?.image?.originalSrc || resource?.images?.[0]?.url || resource?.images?.[0]?.originalSrc || ""; }
function normalizePicked(resource: ShopifyPickerResource | undefined, resourceType: ResourceType): ResourceMeta {
  const image = firstImage(resource);
  return { id: resource?.id || "", gid: resource?.id || "", title: resource?.title || "", image, imageUrl: image, handle: resource?.handle || "", resourceType };
}
function normalizeVariant(variant?: ShopifyPickerVariant, selectedVariantId?: string): ResourceMeta {
  const image = variant?.image?.url || variant?.image?.originalSrc || "";
  const prices = extractPickerVariantPrices(variant, selectedVariantId || variant?.id);
  return { id: variant?.id || "", gid: variant?.id || "", title: variant?.title || variant?.displayName || "", image, imageUrl: image, handle: variant?.handle || "", resourceType: "variant", variantPrice: prices.variantPrice || "", variantCompareAtPrice: prices.variantCompareAtPrice || "", priceSource: prices.priceSource, compareAtPriceSource: prices.compareAtPriceSource };
}
function pickerVariants(resource?: ShopifyPickerResource) {
  if (Array.isArray(resource?.variants)) return resource.variants;
  return resource?.variants?.nodes || [];
}
function firstPicked(result: ShopifyPickerResource[] | ShopifyPickerResource | undefined) { return Array.isArray(result) ? result[0] : result; }
function getPicker() { if (typeof window === "undefined") return undefined; return window.shopify?.resourcePicker; }
function hasAppBridgeGlobal() { if (typeof window === "undefined") return false; return Boolean(window.shopify); }
function typeLabel(type?: string) { return type ? type.charAt(0).toUpperCase() + type.slice(1) : "Shopify resource"; }

function ResourceSummary({ meta, fallbackLabel, onRemove, onChange, productModeNote }: { meta: ResourceMeta; fallbackLabel: string; onRemove: () => void; onChange: () => void; productModeNote?: string }) {
  const gid = meta.gid || meta.id || "";
  const title = meta.title || (gid ? `${fallbackLabel} selected` : `No ${fallbackLabel.toLowerCase()} selected`);
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
    {meta.imageUrl || meta.image ? <img src={meta.imageUrl || meta.image || ""} alt="" className="h-14 w-14 rounded-lg border border-gray-200 object-cover" /> : <div className="grid h-14 w-14 place-items-center rounded-lg border border-dashed border-gray-300 bg-white text-xs text-gray-400">No image</div>}
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-gray-950">{title}</p><p className={helpClass}>Type: {typeLabel(meta.resourceType)}</p>{meta.handle ? <p className={helpClass}>/{meta.handle}</p> : null}{meta.variantTitle ? <p className={helpClass}>Variant: {meta.variantTitle}</p> : null}{productModeNote && gid ? <p className={helpClass}>{productModeNote}</p> : null}{gid ? <p className="truncate text-xs text-gray-400">{gid}</p> : null}</div>
    <div className="flex gap-2"><button type="button" onClick={onChange} className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium">{gid ? "Change" : "Select"}</button>{gid ? <button type="button" onClick={onRemove} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700">Remove</button> : null}</div>
  </div>;
}

type RewardSelectionMode = "product" | "variant";
function cleanOfferVariant(meta: ResourceMeta): ResourceMeta { return { ...meta, variantGid: "", variantTitle: "", variantPrice: "", variantCompareAtPrice: "", priceSource: "unavailable", compareAtPriceSource: "unavailable" }; }

export function ResourcePickerFields({ triggerType: initialTriggerType, triggerValue, triggerProduct, triggerCollection, triggerVariant, offerProduct, initialRewardMode, shopPresent, hostPresent }: { triggerType: string; triggerValue: string; triggerProduct: ResourceMeta; triggerCollection: ResourceMeta; triggerVariant: ResourceMeta; offerProduct: ResourceMeta; initialRewardMode: RewardSelectionMode; shopPresent: boolean; hostPresent: boolean }) {
  const [pickerError, setPickerError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [appBridgeReady, setAppBridgeReady] = useState(false);
  const [resourcePickerReady, setResourcePickerReady] = useState(false);
  const [runtimeHostPresent, setRuntimeHostPresent] = useState(hostPresent);
  const [storedHostPresent, setStoredHostPresent] = useState(false);
  const [triggerType, setTriggerType] = useState(initialTriggerType);
  const [triggerText, setTriggerText] = useState(triggerValue);
  const [product, setProduct] = useState<ResourceMeta>({ ...triggerProduct, resourceType: "product", gid: triggerProduct.gid || (initialTriggerType === "cart_contains_product" ? triggerValue : "") });
  const [collection, setCollection] = useState<ResourceMeta>({ ...triggerCollection, resourceType: "collection", gid: triggerCollection.gid || (initialTriggerType === "cart_contains_collection" ? triggerValue : "") });
  const [triggerVariantState, setTriggerVariantState] = useState<ResourceMeta>({ ...triggerVariant, resourceType: "variant", gid: triggerVariant.gid || (initialTriggerType === "cart_contains_variant" ? triggerValue : "") });
  const [rewardMode, setRewardMode] = useState<RewardSelectionMode>(initialRewardMode === "variant" ? "variant" : "product");
  const [offer, setOffer] = useState<ResourceMeta>(initialRewardMode === "variant" ? { ...offerProduct, resourceType: "product" } : cleanOfferVariant({ ...offerProduct, resourceType: "product" }));
  const [variants, setVariants] = useState<ResourceMeta[]>([]);
  const showTriggerProduct = triggerType === "cart_contains_product";
  const showTriggerCollection = triggerType === "cart_contains_collection";
  const showTriggerVariant = triggerType === "cart_contains_variant";
  const triggerPickerValue = showTriggerProduct ? product.gid : showTriggerCollection ? collection.gid : showTriggerVariant ? triggerVariantState.gid : triggerText;

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
    return () => { cancelled = true; timers.forEach((timer) => window.clearTimeout(timer)); };
  }, []);

  async function pick(type: ResourceType, purpose: "trigger" | "offer") {
    setPickerError("");
    const picker = getPicker();
    if (!hydrated) { setPickerError("Initializing Shopify Resource Picker. Try again in a moment, or use Advanced/debug raw Shopify IDs below."); return; }
    if (!picker) { setPickerError("Shopify Resource Picker is unavailable in this browser context. Use the manual GID fallback below or open this page inside Shopify Admin."); return; }
    const picked = firstPicked(await picker({ type, multiple: false, action: "select" }));
    if (!picked?.id) return;
    if (type === "collection") setCollection(normalizePicked(picked, "collection"));
    if (type === "variant") setTriggerVariantState(normalizePicked(picked, "variant"));
    if (type === "product" && purpose === "trigger") setProduct(normalizePicked(picked, "product"));
    if (type === "product" && purpose === "offer") {
      const nextProduct = normalizePicked(picked, "product");
      const pickedSelectedVariantId = rewardMode === "variant" ? picked.selectedVariant?.id || picked.variant?.id || offer.variantGid || "" : "";
      const nextVariants = pickerVariants(picked).map((variant) => normalizeVariant(variant, pickedSelectedVariantId)).filter((variant) => variant.gid);
      setVariants(nextVariants);
      const extracted = rewardMode === "variant" && (pickedSelectedVariantId || nextVariants.length === 1) ? extractPickerVariantPrices(picked, pickedSelectedVariantId) : { variantPrice: null, variantCompareAtPrice: null, priceSource: "unavailable" as const, compareAtPriceSource: "unavailable" as const };
      const selectedVariant = rewardMode === "variant" ? nextVariants.find((variant) => variant.gid === pickedSelectedVariantId) || (nextVariants.length === 1 ? nextVariants[0] : nextVariants.find((variant) => variant.gid === offer.variantGid)) : undefined;
      if (process.env.NODE_ENV === "development") console.info("[LoopDesk Resource Picker] selected offer variant price capture", { selectedVariantId: selectedVariant?.gid || pickedSelectedVariantId, variantPrice: selectedVariant?.variantPrice || extracted.variantPrice, variantCompareAtPrice: selectedVariant?.variantCompareAtPrice || extracted.variantCompareAtPrice, priceSource: selectedVariant?.priceSource || extracted.priceSource });
      setOffer(rewardMode === "variant" ? { ...nextProduct, variantGid: selectedVariant?.gid || pickedSelectedVariantId || "", variantTitle: selectedVariant?.title || picked.selectedVariant?.title || picked.variant?.title || "", variantPrice: selectedVariant?.variantPrice || extracted.variantPrice || "", variantCompareAtPrice: selectedVariant?.variantCompareAtPrice || extracted.variantCompareAtPrice || "", priceSource: selectedVariant?.priceSource || extracted.priceSource, compareAtPriceSource: selectedVariant?.compareAtPriceSource || extracted.compareAtPriceSource, imageUrl: nextProduct.imageUrl || selectedVariant?.imageUrl || "", image: nextProduct.image || selectedVariant?.image || "" } : cleanOfferVariant(nextProduct));
    }
  }

  const variantOptions = useMemo(() => rewardMode === "variant" ? variants.length ? variants : offer.variantGid ? [{ gid: offer.variantGid, title: offer.variantTitle || "Selected variant", imageUrl: "", image: "", handle: "", resourceType: "variant" as const, variantPrice: offer.variantPrice || "", variantCompareAtPrice: offer.variantCompareAtPrice || "", priceSource: offer.priceSource || "unavailable", compareAtPriceSource: offer.compareAtPriceSource || "unavailable" }] : [] : [], [rewardMode, variants, offer.variantGid, offer.variantTitle, offer.variantPrice, offer.variantCompareAtPrice, offer.priceSource, offer.compareAtPriceSource]);
  const selectedOfferVariantPrice = offer.variantPrice || "";
  const selectedOfferCompareAtPrice = offer.variantCompareAtPrice || "";
  const fallbackVisible = hydrated && !resourcePickerReady;

  return <div className="grid gap-4">
    <input type="hidden" name="triggerType" value={triggerType} /><input type="hidden" name="triggerValue" value={triggerPickerValue} />
    <input type="hidden" name="triggerProductGid" value={product.gid} /><input type="hidden" name="triggerProductTitle" value={product.title} /><input type="hidden" name="triggerProductImageUrl" value={product.imageUrl || product.image || ""} /><input type="hidden" name="triggerProductHandle" value={product.handle} />
    <input type="hidden" name="triggerCollectionGid" value={collection.gid} /><input type="hidden" name="triggerCollectionTitle" value={collection.title} /><input type="hidden" name="triggerCollectionImageUrl" value={collection.imageUrl || collection.image || ""} /><input type="hidden" name="triggerCollectionHandle" value={collection.handle} />
    <input type="hidden" name="triggerVariantGid" value={triggerVariantState.gid} /><input type="hidden" name="triggerVariantTitle" value={triggerVariantState.title} /><input type="hidden" name="triggerVariantImageUrl" value={triggerVariantState.imageUrl || triggerVariantState.image || ""} /><input type="hidden" name="triggerVariantHandle" value={triggerVariantState.handle} />
    <input type="hidden" name="rewardSelectionMode" value={rewardMode} /><input type="hidden" name="offerProductGid" value={offer.gid} /><input type="hidden" name="offerProductTitle" value={offer.title} /><input type="hidden" name="offerProductImageUrl" value={offer.imageUrl || offer.image || ""} /><input type="hidden" name="offerProductHandle" value={offer.handle} /><input type="hidden" name="offerVariantGid" value={rewardMode === "variant" ? offer.variantGid || "" : ""} /><input type="hidden" name="offerVariantTitle" value={rewardMode === "variant" ? offer.variantTitle || "" : ""} /><input type="hidden" name="offerVariantPrice" value={rewardMode === "variant" ? offer.variantPrice || "" : ""} /><input type="hidden" name="offerVariantCompareAtPrice" value={rewardMode === "variant" ? offer.variantCompareAtPrice || "" : ""} />

    <div className="grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium text-gray-800"><span>Trigger type</span><select className={inputClass} value={triggerType} onChange={(event) => setTriggerType(event.target.value)}><option value="always">Always</option><option value="cart_contains_product">Cart contains product</option><option value="cart_contains_collection">Cart contains collection</option><option value="cart_contains_variant">Cart contains variant</option><option value="cart_contains_product_type">Cart contains product type</option><option value="cart_contains_tag">Cart contains tag</option><option value="cart_subtotal_gte">Cart subtotal greater than or equal to</option><option value="cart_quantity_gte">Cart quantity greater than or equal to</option></select></label>{!showTriggerProduct && !showTriggerCollection && !showTriggerVariant ? <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Trigger value</span><input className={inputClass} name="triggerValueText" value={triggerText} onChange={(event) => setTriggerText(event.target.value)} /><span className={helpClass}>Enter product type, tag, subtotal, or quantity based on trigger type.</span></label> : null}</div>
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-950">Shopify embedded diagnostic: shop present: {shopPresent ? "yes" : "no"}; host present: {runtimeHostPresent ? "yes" : "no"}; stored host present: {storedHostPresent ? "yes" : "no"}; app bridge ready: {appBridgeReady ? "yes" : "no"}; resource picker ready: {resourcePickerReady ? "yes" : "no"}.</div>
    {!hydrated ? <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">Initializing Shopify Resource Picker…</div> : !resourcePickerReady ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Shopify Resource Picker is unavailable in this browser context. Manual GID fallback fields are shown below.</div> : null}
    {pickerError ? <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{pickerError}</div> : null}
    {showTriggerProduct ? <div className="grid gap-3"><div><p className="text-sm font-semibold text-gray-950">Trigger product</p><p className={helpClass}>Choose the product customers must have in cart. Any available variant of this product will satisfy the trigger.</p></div><ResourceSummary meta={product} fallbackLabel="Selected product" onChange={() => pick("product", "trigger")} onRemove={() => setProduct({ gid: "", id: "", title: "", image: "", imageUrl: "", handle: "", resourceType: "product" })} />{fallbackVisible ? <input className={inputClass} placeholder="gid://shopify/Product/..." value={product.gid} onChange={(event) => setProduct({ ...product, gid: event.target.value, id: event.target.value, resourceType: "product" })} /> : null}</div> : null}
    {showTriggerCollection ? <div className="grid gap-3"><div><p className="text-sm font-semibold text-gray-950">Trigger collection</p><p className={helpClass}>Choose the collection customers must have in cart.</p></div><ResourceSummary meta={collection} fallbackLabel="Selected collection" onChange={() => pick("collection", "trigger")} onRemove={() => setCollection({ gid: "", id: "", title: "", image: "", imageUrl: "", handle: "", resourceType: "collection" })} />{fallbackVisible ? <input className={inputClass} placeholder="gid://shopify/Collection/..." value={collection.gid} onChange={(event) => setCollection({ ...collection, gid: event.target.value, id: event.target.value, resourceType: "collection" })} /> : null}</div> : null}
    {showTriggerVariant ? <div className="grid gap-3"><div><p className="text-sm font-semibold text-gray-950">Trigger variant</p><p className={helpClass}>Choose the variant customers must have in cart.</p></div><ResourceSummary meta={triggerVariantState} fallbackLabel="Selected variant" onChange={() => pick("variant", "trigger")} onRemove={() => setTriggerVariantState({ gid: "", id: "", title: "", image: "", imageUrl: "", handle: "", resourceType: "variant" })} />{fallbackVisible ? <input className={inputClass} placeholder="gid://shopify/ProductVariant/..." value={triggerVariantState.gid} onChange={(event) => setTriggerVariantState({ ...triggerVariantState, gid: event.target.value, id: event.target.value, resourceType: "variant" })} /> : null}</div> : null}
    <div className="grid gap-3"><label className="grid gap-2 text-sm font-medium text-gray-800"><span>Offer eligibility</span><select className={inputClass} value={rewardMode} onChange={(event) => { const nextMode = event.target.value === "variant" ? "variant" : "product"; setRewardMode(nextMode); if (nextMode === "product") setOffer((current) => cleanOfferVariant(current)); }}><option value="product">All available variants</option><option value="variant">Specific variant only</option></select><span className={helpClass}>For product-level offers, the customer will choose an available variant in the cart drawer before adding the offer.</span></label><div><p className="text-sm font-semibold text-gray-950">Offer product</p><p className={helpClass}>Choose the product that this display-only rule will offer.</p></div><ResourceSummary meta={offer} fallbackLabel="Selected product" productModeNote={rewardMode === "product" ? "Customer selects an available variant in the cart drawer." : undefined} onChange={() => pick("product", "offer")} onRemove={() => setOffer({ gid: "", id: "", title: "", image: "", imageUrl: "", handle: "", resourceType: "product", variantGid: "", variantTitle: "", variantPrice: "", variantCompareAtPrice: "", priceSource: "unavailable", compareAtPriceSource: "unavailable" })} />{fallbackVisible ? <input className={inputClass} placeholder="gid://shopify/Product/..." value={offer.gid} onChange={(event) => setOffer((current) => ({ ...(rewardMode === "product" ? cleanOfferVariant(current) : current), gid: event.target.value, id: event.target.value, resourceType: "product" }))} /> : null}{rewardMode === "variant" ? variantOptions.length ? <label className="grid gap-2 text-sm font-medium text-gray-800"><span>Offer variant</span><select className={inputClass} value={offer.variantGid || ""} onChange={(event) => { const variant = variantOptions.find((next) => next.gid === event.target.value); setOffer({ ...offer, variantGid: event.target.value, variantTitle: variant?.title || "", variantPrice: variant?.variantPrice || "", variantCompareAtPrice: variant?.variantCompareAtPrice || "", priceSource: variant?.priceSource || "unavailable", compareAtPriceSource: variant?.compareAtPriceSource || "unavailable" }); }}><option value="">Select variant</option>{variantOptions.map((variant) => <option key={variant.gid} value={variant.gid}>{variant.title || variant.gid}</option>)}</select><span className={helpClass}>Original price: {selectedOfferVariantPrice ? `${selectedOfferVariantPrice} derived from selected Shopify variant price` : "Unavailable from Shopify picker; legacy override can be used as fallback."} Automatically derived from the selected offer variant’s current Shopify price.</span><span className={helpClass}>Selected variant ID: {offer.variantGid || "not selected"}; captured price: {selectedOfferVariantPrice || "unavailable"}; compare-at price: {selectedOfferCompareAtPrice || "unavailable"}; price source: {offer.priceSource || "unavailable"}.</span></label> : fallbackVisible ? <input className={inputClass} placeholder="gid://shopify/ProductVariant/..." value={offer.variantGid || ""} onChange={(event) => setOffer({ ...offer, variantGid: event.target.value })} /> : <p className={helpClass}>Select an offer product to choose its variant.</p> : <p className={helpClass}>Product GID: {offer.gid || "not selected"}. Customer selects an available variant in the cart drawer.</p>}</div>
  </div>;
}
