"use client";

import { useState } from "react";
import { addProductType, type ProductTypeSelection } from "../../../services/promotions/resource-picker";

export default function ProductTypeEditor({ values, onChange, disabled }: { values: ProductTypeSelection[]; onChange: (values: ProductTypeSelection[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  function add() { onChange(addProductType(values, draft)); setDraft(""); }
  return <div className="space-y-2">
    <div className="flex gap-2"><input className="mk-input" disabled={disabled} aria-label="Product type" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Enter product type" /><button type="button" disabled={disabled} onClick={add} className="mk-btn">Add</button></div>
    <div className="flex flex-wrap gap-2">{values.map((item) => <span key={item.normalizedValue} className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm">{item.displayTitle}<button type="button" disabled={disabled} aria-label={`Remove ${item.displayTitle}`} onClick={() => onChange(values.filter((v) => v.normalizedValue !== item.normalizedValue))} className="text-gray-500 disabled:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500">×</button></span>)}</div>
  </div>;
}
