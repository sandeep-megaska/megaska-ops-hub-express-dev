import { normalizeProductType, normalizeShopifyCollectionGid, normalizeShopifyProductGid } from "./normalization.ts";
import type { PromotionTriggerType } from "./domain.ts";

export type PickerResourceType = "product" | "collection";
export type ShopifyPickerImage = { url?: string | null; originalSrc?: string | null };
export type ShopifyPickerResource = { id?: string | null; title?: string | null; handle?: string | null; image?: ShopifyPickerImage | null; images?: ShopifyPickerImage[] | null; variants?: unknown[] };
export type NormalizedPickerResource = { gid: string; title: string | null; handle: string | null; imageUrl: string | null };
export type SelectedResource = NormalizedPickerResource & { resourceType: "PRODUCT" | "COLLECTION" };
export type ProductTypeSelection = { value: string; normalizedValue: string; displayTitle: string };

export function imageUrl(resource: ShopifyPickerResource) {
  return resource.image?.originalSrc || resource.image?.url || resource.images?.[0]?.originalSrc || resource.images?.[0]?.url || null;
}

export function normalizePickerResource(resource: ShopifyPickerResource, type: "PRODUCT" | "COLLECTION"): SelectedResource | null {
  const gid = type === "PRODUCT" ? normalizeShopifyProductGid(resource.id) : normalizeShopifyCollectionGid(resource.id);
  if (!gid) return null;
  return { gid, title: resource.title?.trim() || null, handle: resource.handle?.trim() || null, imageUrl: imageUrl(resource), resourceType: type };
}

export function normalizePickerResources(resources: ShopifyPickerResource[] | ShopifyPickerResource | undefined, type: "PRODUCT" | "COLLECTION") {
  if (resources === undefined) return undefined;
  const list = Array.isArray(resources) ? resources : [resources];
  const seen = new Set<string>();
  const selected: SelectedResource[] = [];
  for (const resource of list) {
    const normalized = normalizePickerResource(resource, type);
    if (!normalized || seen.has(normalized.gid)) continue;
    seen.add(normalized.gid);
    selected.push(normalized);
  }
  return selected;
}

export function normalizeOfferProduct(resources: ShopifyPickerResource[] | ShopifyPickerResource | undefined) {
  const selected = normalizePickerResources(resources, "PRODUCT");
  return selected === undefined ? undefined : selected[0] ?? null;
}

const productFilter = { variants: false, draft: false, archived: false } as const;

export function productTriggerPickerOptions(selectionIds: string[] = []) {
  return { type: "product", action: "select", multiple: true, selectionIds: selectionIds.map((id) => ({ id })), filter: productFilter } as const;
}

export function collectionTriggerPickerOptions(selectionIds: string[] = []) {
  return { type: "collection", action: "select", multiple: true, selectionIds: selectionIds.map((id) => ({ id })) } as const;
}

export function offerProductPickerOptions(selectionId?: string | null) {
  return { type: "product", action: "select", multiple: false, selectionIds: selectionId ? [{ id: selectionId }] : [], filter: productFilter } as const;
}

export function normalizeProductTypeEntry(value: string): ProductTypeSelection | null {
  const displayTitle = value.trim().normalize("NFKC");
  const normalizedValue = normalizeProductType(displayTitle);
  return normalizedValue ? { value: displayTitle, normalizedValue, displayTitle } : null;
}

export function addProductType(values: ProductTypeSelection[], value: string) {
  const next = normalizeProductTypeEntry(value);
  if (!next || values.some((item) => item.normalizedValue === next.normalizedValue)) return values;
  return [...values, next];
}

export function selectedToTriggerReferences(selected: SelectedResource[], triggerType: PromotionTriggerType) {
  if (triggerType === "PRODUCT") return selected.filter((r) => r.resourceType === "PRODUCT").map((r) => ({ sourceType: "PRODUCT" as const, referenceGid: r.gid, displayTitle: r.title, displayHandle: r.handle, displayImageUrl: r.imageUrl }));
  if (triggerType === "COLLECTION") return selected.filter((r) => r.resourceType === "COLLECTION").map((r) => ({ sourceType: "COLLECTION" as const, referenceGid: r.gid, displayTitle: r.title, displayHandle: r.handle, displayImageUrl: r.imageUrl }));
  return [];
}

export function productTypesToTriggerReferences(values: ProductTypeSelection[]) {
  return values.map((item) => ({ sourceType: "PRODUCT_TYPE" as const, referenceValue: item.value, normalizedValue: item.normalizedValue, displayTitle: item.displayTitle }));
}
