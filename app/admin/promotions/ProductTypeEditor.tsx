"use client";

import { useState } from "react";
import { addProductType, type ProductTypeSelection } from "../../../services/promotions/resource-picker";

export default function ProductTypeEditor({ values, onChange }: { values: ProductTypeSelection[]; onChange: (values: ProductTypeSelection[]) => void }) {
  const [draft, setDraft] = useState("");
  function add() { onChange(addProductType(values, draft)); setDraft(""); }
  return <div className="space-y-2">
    <div className="flex gap-2"><input className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Enter product type" /><button type="button" onClick={add} className="mt-1 rounded-lg border px-3 py-2 text-sm">Add</button></div>
    <div className="flex flex-wrap gap-2">{values.map((item) => <span key={item.normalizedValue} className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm">{item.displayTitle}<button type="button" onClick={() => onChange(values.filter((v) => v.normalizedValue !== item.normalizedValue))} className="text-gray-500">×</button></span>)}</div>
  </div>;
}
