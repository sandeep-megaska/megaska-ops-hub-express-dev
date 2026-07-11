export default function PromotionFormSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <fieldset className="rounded-2xl border border-gray-200 p-5">
    <legend className="px-1 text-base font-semibold text-gray-900">{title}</legend>
    {description ? <p className="mb-4 text-sm text-gray-600">{description}</p> : null}
    <div className="grid gap-4 md:grid-cols-2">{children}</div>
  </fieldset>;
}
