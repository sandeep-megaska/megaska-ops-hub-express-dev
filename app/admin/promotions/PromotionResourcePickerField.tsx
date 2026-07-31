"use client";

import { useState } from "react";
import { useEmbeddedAdminStatus } from "../../AdminEmbeddedProvider";
import { collectionTriggerPickerOptions, normalizeOfferProduct, normalizePickerResources, offerProductPickerOptions, productTriggerPickerOptions, type SelectedResource } from "../../../services/promotions/resource-picker";
import SelectedResourceCard from "./SelectedResourceCard";

type ShopifyPicker = (options: Record<string, unknown>) => Promise<unknown>;
function resourcePicker(): ShopifyPicker | undefined { return (window.shopify?.resourcePicker as ShopifyPicker | undefined); }

export default function PromotionResourcePickerField({ kind, selections, onChange, disabled }: { kind: "product-trigger" | "collection-trigger" | "offer-product"; selections: SelectedResource[]; onChange: (next: SelectedResource[]) => void; disabled?: boolean }) {
  const status = useEmbeddedAdminStatus();
  const [loading, setLoading] = useState(false);
  const pickerAvailable = status?.resourcePickerAvailable ?? false;
  const initializing = !status?.appBridgeInitialized && !pickerAvailable;
  const isOffer = kind === "offer-product";
  const title = kind === "collection-trigger" ? "Trigger collections" : isOffer ? "Offer product" : "Trigger products";
  async function openPicker() {
    const picker = resourcePicker();
    if (!picker) return;
    setLoading(true);
    try {
      const options = kind === "collection-trigger" ? collectionTriggerPickerOptions(selections.map((r) => r.gid)) : isOffer ? offerProductPickerOptions(selections[0]?.gid) : productTriggerPickerOptions(selections.map((r) => r.gid));
      const result = await picker(options as unknown as Record<string, unknown>);
      if (result === undefined) return;
      if (isOffer) {
        const offer = normalizeOfferProduct(result as never);
        onChange(offer ? [offer] : []);
      } else {
        onChange(normalizePickerResources(result as never, kind === "collection-trigger" ? "COLLECTION" : "PRODUCT") ?? selections);
      }
    } finally { setLoading(false); }
  }
  return <section className="mk-card space-y-3">
    <div className="flex items-center justify-between gap-3"><div><h3 className="mk-section-title" style={{ margin: 0 }}>{title}</h3><p className="mk-help">{isOffer ? "Select one Shopify product. Variants are ignored." : "Select Shopify resources for this trigger."}</p></div><div className="mk-header-actions"><button type="button" disabled={disabled || !pickerAvailable || loading} onClick={openPicker} className="mk-btn mk-btn-primary mk-btn-sm">{loading ? "Opening…" : isOffer && selections.length ? "Change product" : "Select"}</button>{isOffer && selections.length ? <button type="button" disabled={disabled} onClick={() => onChange([])} className="mk-btn mk-btn-danger mk-btn-sm">Remove product</button> : null}</div></div>
    {initializing ? <p className="mk-alert mk-alert-info">Connecting to Shopify Admin…</p> : !pickerAvailable ? <p className="mk-alert mk-alert-info">Shopify Resource Picker is unavailable. Open this page from the Shopify Admin app.</p> : null}
    <div className="grid gap-2">{selections.map((resource) => <SelectedResourceCard key={resource.gid} resource={resource} onRemove={() => onChange(selections.filter((item) => item.gid !== resource.gid))} />)}</div>
  </section>;
}
