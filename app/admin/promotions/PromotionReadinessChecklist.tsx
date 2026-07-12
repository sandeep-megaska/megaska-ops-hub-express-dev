import type { ReadinessItem } from "../../../services/promotions/form-validation";
export default function PromotionReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-5" aria-labelledby="readiness-title">
    <h2 id="readiness-title" className="text-base font-semibold text-gray-900">Activation readiness</h2>
    <p className="mt-1 text-sm text-gray-600">This checklist is advisory. Activation still runs server validation before status changes.</p>
    <ul className="mt-3 space-y-2 text-sm">{items.map((item) => <li key={item.key} className={item.complete ? "text-green-700" : "text-gray-600"}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span> {item.label}</li>)}</ul>
  </section>;
}
