export default function PromotionFormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <fieldset className="mk-card">
    <legend className="mk-section-title" style={{ padding: "0 4px" }}>{title}</legend>
    {description ? <p className="mk-section-subtitle">{description}</p> : null}
    <div className="mk-form-grid">{children}</div>
  </fieldset>;
}
