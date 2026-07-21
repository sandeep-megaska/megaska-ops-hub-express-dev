type SectionHeadingProps = { eyebrow: string; title: string; description?: string; align?: "left" | "center"; id?: string };
export function SectionHeading({ eyebrow, title, description, align = "left", id }: SectionHeadingProps) {
  return <div className={`ld-section-heading ld-section-heading--${align}`}><p className="ld-eyebrow">{eyebrow}</p><h2 id={id}>{title}</h2>{description ? <p>{description}</p> : null}</div>;
}
