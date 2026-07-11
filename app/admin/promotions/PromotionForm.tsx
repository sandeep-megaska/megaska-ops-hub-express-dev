"use client";

import { useActionState, useMemo, useState } from "react";
import { archivePromotionRuleAction, changePromotionStatusAction, createPromotionDraftAction, updatePromotionDraftAction, type PromotionActionState } from "../../../services/promotions/admin-actions.server";
import type { PromotionEmbeddedContext } from "../../../services/promotions/admin-actions.server";
import type { PromotionTriggerType } from "../../../services/promotions/domain";
import type { PromotionRuleRecord } from "../../../services/promotions/repository.server";
import { normalizeProductTypeEntry, type ProductTypeSelection, type SelectedResource } from "../../../services/promotions/resource-picker";
import ProductTypeEditor from "./ProductTypeEditor";
import PromotionResourcePickerField from "./PromotionResourcePickerField";

const initial: PromotionActionState = { ok: true };
const inputClass = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";

function Field({ label, name, defaultValue, type = "text", help }: { label: string; name: string; defaultValue?: string | number | null; type?: string; help?: string }) {
  return <label className="block text-sm font-medium text-gray-700">{label}<input className={inputClass} name={name} type={type} defaultValue={defaultValue ?? ""} />{help ? <span className="mt-1 block text-xs text-gray-500">{help}</span> : null}</label>;
}
function Errors({ state }: { state: PromotionActionState }) { return !state.message && !state.errors?.length ? null : <div className={`rounded-lg border p-3 text-sm ${state.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}><p>{state.message}</p>{state.errors?.length ? <ul className="mt-2 list-disc pl-5">{state.errors.map((e) => <li key={`${e.field}:${e.message}`}>{e.field}: {e.message}</li>)}</ul> : null}</div>; }
function dateValue(value?: Date | string | null) { return value ? new Date(value).toISOString().slice(0, 16) : ""; }
function resourceSelections(rule: PromotionRuleRecord | null | undefined, type: "PRODUCT" | "COLLECTION"): SelectedResource[] { return rule?.triggerReferences?.filter((r) => r.sourceType === type && r.referenceGid).map((r) => ({ gid: r.referenceGid!, title: r.displayTitle || r.referenceGid!, handle: r.displayHandle || null, imageUrl: r.displayImageUrl || null, resourceType: type })) ?? []; }
function productTypes(rule: PromotionRuleRecord | null | undefined): ProductTypeSelection[] { return rule?.triggerReferences?.filter((r) => r.sourceType === "PRODUCT_TYPE").map((r) => normalizeProductTypeEntry(r.referenceValue || r.displayTitle || r.normalizedValue || "")).filter((item): item is ProductTypeSelection => Boolean(item)) ?? []; }
function offer(rule: PromotionRuleRecord | null | undefined): SelectedResource[] { return rule?.offerProductGid ? [{ gid: rule.offerProductGid, title: rule.offerProductTitle || rule.offerProductGid, handle: rule.offerProductHandle || null, imageUrl: rule.offerProductImageUrl || null, resourceType: "PRODUCT" }] : []; }

function EmbeddedInputs({ shopId, context }: { shopId: string; context: PromotionEmbeddedContext }) {
  return <>
    <input type="hidden" name="shopId" value={shopId} />
    <input type="hidden" name="shop" value={String(context.shop || "")} />
    <input type="hidden" name="shopify_shop" value={String(context.shopify_shop || "")} />
    <input type="hidden" name="host" value={String(context.host || "")} />
    <input type="hidden" name="embedded" value={String(context.embedded || "")} />
  </>;
}

export default function PromotionForm({ shopId, embeddedContext, rule }: { shopId: string; shopDomain: string; embeddedContext: PromotionEmbeddedContext; rule?: PromotionRuleRecord | null }) {
  const [saveState, saveAction] = useActionState(rule ? updatePromotionDraftAction : createPromotionDraftAction, initial);
  const [statusState, statusAction] = useActionState(changePromotionStatusAction, initial);
  const [archiveState, archiveAction] = useActionState(archivePromotionRuleAction, initial);
  const [triggerType, setTriggerType] = useState<PromotionTriggerType>(rule?.triggerType || "PRODUCT");
  const [productTriggers, setProductTriggers] = useState(() => resourceSelections(rule, "PRODUCT"));
  const [collectionTriggers, setCollectionTriggers] = useState(() => resourceSelections(rule, "COLLECTION"));
  const [typeTriggers, setTypeTriggers] = useState(() => productTypes(rule));
  const [offerProduct, setOfferProduct] = useState(() => offer(rule));
  const disabled = rule?.status === "ARCHIVED";
  const triggerReferencesValue = useMemo(() => {
    if (triggerType === "PRODUCT") return productTriggers.map((r) => r.gid).join("\n");
    if (triggerType === "COLLECTION") return collectionTriggers.map((r) => r.gid).join("\n");
    return typeTriggers.map((r) => r.value).join("\n");
  }, [collectionTriggers, productTriggers, triggerType, typeTriggers]);
  function switchTriggerType(next: PromotionTriggerType) {
    if (next === triggerType) return;
    const hasSelections = productTriggers.length > 0 || collectionTriggers.length > 0 || typeTriggers.length > 0;
    if (hasSelections && !window.confirm("Changing trigger type clears incompatible trigger selections. Continue?")) return;
    setTriggerType(next); setProductTriggers([]); setCollectionTriggers([]); setTypeTriggers([]);
  }
  return <div className="space-y-4">
    <Errors state={saveState} /><Errors state={statusState} /><Errors state={archiveState} />
    <form action={saveAction} className="space-y-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <EmbeddedInputs shopId={shopId} context={embeddedContext} /><input type="hidden" name="id" value={rule?.id || ""} />
      <input type="hidden" name="triggerReferences" value={triggerReferencesValue} />
      <input type="hidden" name="offerProductGid" value={offerProduct[0]?.gid || ""} />
      <input type="hidden" name="offerProductTitle" value={offerProduct[0]?.title || ""} />
      <input type="hidden" name="offerProductHandle" value={offerProduct[0]?.handle || ""} />
      <input type="hidden" name="offerProductImageUrl" value={offerProduct[0]?.imageUrl || ""} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Internal name" name="name" defaultValue={rule?.name} />
        <Field label="Priority" name="priority" type="number" defaultValue={rule?.priority ?? 0} />
        <label className="block text-sm font-medium text-gray-700">Internal description<textarea className={inputClass} name="description" defaultValue={rule?.description || ""} /></label>
        <label className="block text-sm font-medium text-gray-700">Trigger type<select className={inputClass} name="triggerType" value={triggerType} onChange={(e) => switchTriggerType(e.target.value as PromotionTriggerType)}><option value="PRODUCT">Product</option><option value="COLLECTION">Collection</option><option value="PRODUCT_TYPE">Product type</option></select></label>
        <label className="block text-sm font-medium text-gray-700">Trigger match mode<select className={inputClass} name="triggerMatchMode" defaultValue={rule?.triggerMatchMode || "ANY"}><option value="ANY">Any</option><option value="ALL">All</option></select></label>
        <Field label="Minimum trigger quantity" name="minimumTriggerQuantity" type="number" defaultValue={rule?.minimumTriggerQuantity ?? 1} />
        <Field label="Optional minimum cart subtotal" name="minimumCartSubtotal" type="number" defaultValue={String(rule?.minimumCartSubtotal ?? "")} />
        <label className="block text-sm font-medium text-gray-700">Reward type<select className={inputClass} name="rewardType" defaultValue={rule?.rewardType || "PERCENTAGE_OFF"}><option value="PERCENTAGE_OFF">Percentage off</option><option value="FIXED_AMOUNT_OFF">Fixed amount off</option><option value="FIXED_PRICE">Fixed price</option></select></label>
        <Field label="Reward value" name="rewardValue" type="number" defaultValue={String(rule?.rewardValue ?? "")} />
        <Field label="Maximum reward quantity" name="maximumRewardQuantity" type="number" defaultValue={rule?.maximumRewardQuantity ?? 1} />
        <Field label="Start date" name="startsAt" type="datetime-local" defaultValue={dateValue(rule?.startsAt)} />
        <Field label="End date" name="endsAt" type="datetime-local" defaultValue={dateValue(rule?.endsAt)} />
        <Field label="Heading" name="heading" defaultValue={rule?.heading} /><Field label="Badge text" name="badgeText" defaultValue={rule?.badgeText} />
        <Field label="Customer message" name="customerMessage" defaultValue={rule?.customerMessage} /><Field label="CTA text" name="ctaText" defaultValue={rule?.ctaText} />
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="w-full font-medium">Combination flags</legend><label><input type="checkbox" name="combinesWithProductDiscounts" defaultChecked={rule?.combinesWithProductDiscounts} /> Product discounts</label><label><input type="checkbox" name="combinesWithOrderDiscounts" defaultChecked={rule?.combinesWithOrderDiscounts ?? true} /> Order discounts</label><label><input type="checkbox" name="combinesWithShippingDiscounts" defaultChecked={rule?.combinesWithShippingDiscounts ?? true} /> Shipping discounts</label></fieldset>
      {triggerType === "PRODUCT" ? <PromotionResourcePickerField kind="product-trigger" selections={productTriggers} onChange={setProductTriggers} disabled={disabled} /> : null}
      {triggerType === "COLLECTION" ? <PromotionResourcePickerField kind="collection-trigger" selections={collectionTriggers} onChange={setCollectionTriggers} disabled={disabled} /> : null}
      {triggerType === "PRODUCT_TYPE" ? <ProductTypeEditor values={typeTriggers} onChange={setTypeTriggers} /> : null}
      <PromotionResourcePickerField kind="offer-product" selections={offerProduct} onChange={setOfferProduct} disabled={disabled} />
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Execution setup pending. Not compiled.</p>
      <button disabled={disabled} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">Save draft</button>
    </form>
    {rule ? <div className="flex gap-3"><form action={statusAction}><EmbeddedInputs shopId={shopId} context={embeddedContext} /><input type="hidden" name="id" value={rule.id} /><input type="hidden" name="status" value={rule.status === "ACTIVE" ? "PAUSED" : "ACTIVE"} /><button disabled={disabled} className="rounded-lg border px-4 py-2 text-sm">{rule.status === "ACTIVE" ? "Pause" : "Activate"}</button></form><form action={archiveAction}><EmbeddedInputs shopId={shopId} context={embeddedContext} /><input type="hidden" name="id" value={rule.id} /><button disabled={disabled} className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700">Archive</button></form></div> : null}
  </div>;
}
