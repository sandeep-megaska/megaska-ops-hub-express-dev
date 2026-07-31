"use client";

import type { SelectedResource } from "../../../services/promotions/resource-picker";

export default function SelectedResourceCard({ resource, onRemove }: { resource: SelectedResource; onRemove: () => void }) {
  const title = resource.title || resource.gid;
  return <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
    {resource.imageUrl ? <img src={resource.imageUrl} alt="" className="h-12 w-12 rounded-md object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-md bg-gray-100 text-xs text-gray-500">No image</div>}
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900">{title}</p>{resource.handle ? <p className="truncate text-xs text-gray-500">{resource.handle}</p> : null}<p className="text-xs text-gray-500">{resource.resourceType === "PRODUCT" ? "Product" : "Collection"}</p></div>
    <button type="button" onClick={onRemove} className="mk-btn mk-btn-sm">Remove</button>
  </div>;
}
