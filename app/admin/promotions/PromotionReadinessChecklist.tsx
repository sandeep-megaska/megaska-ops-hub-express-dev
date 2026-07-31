import type { ReadinessItem } from "../../../services/promotions/form-validation";
export default function PromotionReadinessChecklist({ items }: { items: ReadinessItem[] }) {
  return <section className="mk-card" aria-labelledby="readiness-title">
    <h2 id="readiness-title" className="mk-section-title">Activation readiness</h2>
    <p className="mk-section-subtitle">This checklist is advisory. Activation still runs server validation before status changes.</p>
    <ul className="mk-list mt-3 text-sm" style={{ gap: "8px" }}>{items.map((item) => <li key={item.key} className="mk-check" style={{ color: item.complete ? "var(--success-text)" : "var(--muted)", cursor: "default" }}><span aria-hidden="true">{item.complete ? "✓" : "○"}</span> {item.label}</li>)}</ul>
  </section>;
}
