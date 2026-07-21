import { homepageConfig } from "@/config/homepage";
export function FounderStorySection(){const f=homepageConfig.founder; return <section className="ld-section ld-band" aria-labelledby="founder-title"><p className="ld-eyebrow">{f.eyebrow}</p><h2 id="founder-title">{f.title}</h2><p>{f.description}</p><a className="ld-button" href={f.cta.href}>{f.cta.label}</a></section>}
