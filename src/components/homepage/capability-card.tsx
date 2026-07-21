import type { Capability } from "@/config/homepage";
export function CapabilityCard({ title, problem, response, labels, href, linkLabel, status }: Capability) {
  return <article className="ld-card ld-capability-card"><div>{status ? <p className="ld-status">{status}</p> : null}<h3>{title}</h3><p className="ld-muted"><strong>Problem:</strong> {problem}</p><p>{response}</p></div><ul className="ld-tags" aria-label={`${title} capabilities`}>{labels.map((label) => <li key={label}>{label}</li>)}</ul><a className="ld-text-link" href={href}>{linkLabel}</a></article>;
}
