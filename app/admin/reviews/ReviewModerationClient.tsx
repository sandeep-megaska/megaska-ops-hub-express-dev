"use client";
/* eslint-disable @next/next/no-img-element -- review snapshots can be external Shopify CDN URLs. */

import { useEffect, useId, useRef, useState } from "react";
import styles from "./ReviewModerationClient.module.css";
import { reviewEmptyState, reviewStatusBadgeTone, reviewStatusLabel, type ReviewAdminStatus } from "../../../services/reviews/review-admin-ui";

type Status = ReviewAdminStatus;
type Review = { id:string; status:Exclude<Status,"ALL">; rating:number; title:string|null; body:string|null; customerDisplayName:string; verifiedPurchase:boolean; productTitleSnapshot:string; variantTitleSnapshot:string|null; productImageUrl:string|null; shopifyOrderName:string|null; submittedAt:string; publishedAt:string|null; moderatedAt:string|null; rejectionReason:string|null };
type Data = { reviews:Review[]; total:number; counts:{pending:number;published:number;rejected:number;total:number} };
type DialogAction = "REJECT" | "UNPUBLISH" | null;
const statuses: Array<{ value:Status; label:string }> = [{value:"PENDING_MODERATION",label:"Pending"},{value:"PUBLISHED",label:"Published"},{value:"REJECTED",label:"Rejected"},{value:"ALL",label:"All"}];
const date = (value:string|null) => value ? new Date(value).toLocaleString() : "—";
const statusClass = (status:Status) => `mk-badge-${reviewStatusBadgeTone(status)}`;

function Stars({ rating }: { rating:number }) { return <span className={styles.stars} aria-label={`${rating} out of 5 stars`} role="img">{"★".repeat(rating)}<span className={styles.emptyStars}>{"★".repeat(5-rating)}</span><span className="sr-only">{rating} out of 5 stars</span></span>; }
function ProductImage({ review }: { review:Review }) { const [failed, setFailed] = useState(false); return review.productImageUrl && !failed ? <img className={styles.productImage} src={review.productImageUrl} alt="" onError={() => setFailed(true)} /> : <div className={styles.productFallback} role="img" aria-label="Product image unavailable">▧</div>; }
function Skeleton({ className = "" }: { className?:string }) { return <span className={`${styles.skeleton} ${className}`} aria-hidden="true" />; }
function Empty({ title, body, onClear, clearLabel }: { title:string; body:string; onClear?:()=>void; clearLabel?:string }) { return <div className={styles.empty}><h3>{title}</h3><p>{body}</p>{onClear && <button className="mk-btn" type="button" onClick={onClear}>{clearLabel}</button>}</div>; }

export default function ReviewModerationClient({ shop, reviewsEnabled }: { shop:string; reviewsEnabled:boolean }) {
  const [status, setStatus] = useState<Status>("PENDING_MODERATION");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [data, setData] = useState<Data|null>(null);
  const [selected, setSelected] = useState<Review|null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [dialogAction, setDialogAction] = useState<DialogAction>(null);
  const [success, setSuccess] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  const dialogTitleId = useId();

  useEffect(() => { const timer = window.setTimeout(() => setSearch(searchInput), 250); return () => window.clearTimeout(timer); }, [searchInput]);
  useEffect(() => { if (dialogAction) window.setTimeout(() => cancelButton.current?.focus(), 0); }, [dialogAction]);
  useEffect(() => { const onKeyDown = (event:KeyboardEvent) => { if (event.key === "Escape" && dialogAction) setDialogAction(null); }; window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown); }, [dialogAction]);

  async function fetchDetail(id:string) {
    setDetailLoading(true);
    try { const response = await fetch(`/api/admin/reviews/${id}?shop=${encodeURIComponent(shop)}`, { cache:"no-store" }); if (!response.ok) throw new Error(); const body = await response.json(); setSelected(body.review); }
    catch { setError("Could not load review details. Select the review again to retry."); }
    finally { setDetailLoading(false); }
  }
  async function load({ background = false } = {}) {
    if (!background) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ shop, status, search });
      const response = await fetch(`/api/admin/reviews?${params}`, { cache:"no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error();
      setData(body);
      if (selected) await fetchDetail(selected.id);
    } catch { setError("Could not load reviews. Please try again."); }
    finally { if (!background) setLoading(false); }
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, search, shop]);

  function chooseReview(review:Review) { setSelected(review); setReason(""); setSuccess(""); void fetchDetail(review.id); }
  async function moderate(action:"PUBLISH"|"REJECT"|"UNPUBLISH") {
    if (!selected || busy) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const response = await fetch(`/api/admin/reviews/${selected.id}/moderate?shop=${encodeURIComponent(shop)}`, { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action, rejectionReason:action === "REJECT" ? reason : undefined}) });
      if (!response.ok) throw new Error();
      setReason(""); setDialogAction(null); setSuccess(action === "PUBLISH" ? "Review published." : action === "REJECT" ? "Review rejected." : "Review returned to pending moderation.");
      await load({background:true});
    } catch { setError("Could not update this review. Please try again."); }
    finally { setBusy(false); }
  }
  const noResults = !loading && data?.reviews.length === 0;
  const emptyCopy = reviewEmptyState(search, status);
  const empty = search ? {...emptyCopy,clearLabel:emptyCopy.action,onClear:()=>setSearchInput("")} : status !== "ALL" ? {...emptyCopy,clearLabel:emptyCopy.action,onClear:()=>setStatus("ALL")} : {...emptyCopy};

  return <section className="mk-page" aria-labelledby="reviews-heading">
    <header className="mk-page-header"><div><h1 id="reviews-heading" className="mk-page-title">Reviews</h1><p className="mk-page-subtitle">Manage verified-purchase reviews, moderation, and storefront publication.</p></div><a className="mk-btn" href="#review-settings">Review settings</a></header>
    {!reviewsEnabled && <aside className={`${styles.notice} ${styles.noticeWarning}`}><div><strong>Review collection paused</strong><p>New review collection is disabled. Historical reviews remain available for moderation.</p></div><a className="mk-btn" href="#review-settings">Open Review Settings</a></aside>}
    {reviewsEnabled && <p className={`${styles.notice} ${styles.noticePositive}`}><strong>Review collection is enabled.</strong> New verified-purchase reviews will appear here when submitted.</p>}
    <div className={styles.kpis} aria-label="Review summary">{data ? ([{label:"Pending",count:data.counts.pending,value:"PENDING_MODERATION"},{label:"Published",count:data.counts.published,value:"PUBLISHED"},{label:"Rejected",count:data.counts.rejected,value:"REJECTED"},{label:"Total Reviews",count:data.counts.total,value:"ALL"}] as const).map(card => <button key={card.value} type="button" onClick={()=>setStatus(card.value)} aria-pressed={status===card.value} className={`${styles.kpi} ${status===card.value ? styles.kpiActive : ""}`}><span>{card.label}</span><strong>{card.count}</strong><small>{status === card.value ? "Selected filter" : "Filter reviews"}</small></button>) : Array.from({length:4},(_,index)=><div className={styles.kpi} key={index}><Skeleton className={styles.skeletonLabel}/><Skeleton className={styles.skeletonValue}/></div>)}</div>
    <section className={`mk-card ${styles.toolbar}`} aria-label="Review filters"><div className={styles.filters} role="group" aria-label="Review status">{statuses.map(item=><button type="button" key={item.value} className={status===item.value ? styles.filterActive : styles.filter} aria-pressed={status===item.value} onClick={()=>setStatus(item.value)}>{item.label}</button>)}</div><label className={styles.search}><span className="sr-only">Search reviews</span><input value={searchInput} onChange={event=>setSearchInput(event.target.value)} placeholder="Search product, order, customer, or review text" />{searchInput && <button type="button" onClick={()=>setSearchInput("")} aria-label="Clear review search">Clear</button>}</label></section>
    <div aria-live="polite" className="sr-only">{success || error}</div>{success && <p className={styles.success} role="status">{success}</p>}{error && <div className={styles.error} role="alert">{error}<button type="button" onClick={()=>void load()}>Retry</button></div>}
    <section className={styles.results} aria-label="Review results">{loading && !data ? <><div className={styles.list}>{Array.from({length:4},(_,i)=><div className={styles.reviewSkeleton} key={i}><Skeleton className={styles.skeletonImage}/><div><Skeleton className={styles.skeletonLine}/><Skeleton className={styles.skeletonLine}/></div></div>)}</div></> : noResults ? <Empty {...empty} /> : <><div className={styles.list}>{data?.reviews.map(review=><button type="button" key={review.id} onClick={()=>chooseReview(review)} className={`${styles.reviewItem} ${selected?.id===review.id ? styles.selected : ""}`} aria-pressed={selected?.id===review.id}><ProductImage review={review}/><div className={styles.reviewCopy}><div className={styles.itemTop}><span className={`mk-badge ${statusClass(review.status)}`}>{reviewStatusLabel(review.status)}</span><Stars rating={review.rating}/></div><h2>{review.title || "Untitled review"}</h2><p className={styles.bodyPreview}>{review.body || "No written review."}</p><p className={styles.meta}>{review.productTitleSnapshot}{review.variantTitleSnapshot ? ` · ${review.variantTitleSnapshot}` : ""}</p><p className={styles.meta}>{review.customerDisplayName} {review.verifiedPurchase && <span className="mk-badge mk-badge-success">Verified Purchase</span>} · {review.shopifyOrderName || "No order reference"} · {date(review.submittedAt)}</p></div><span className={styles.viewDetails}>View details</span></button>)}</div>{selected && <aside className={styles.detail} aria-label="Selected review details">{detailLoading ? <div className={styles.detailSkeleton}><Skeleton className={styles.skeletonLine}/><Skeleton className={styles.skeletonLine}/><Skeleton className={styles.skeletonLine}/></div> : <><div className={styles.detailHeader}><div><span className={`mk-badge ${statusClass(selected.status)}`}>{reviewStatusLabel(selected.status)}</span><h2>{selected.title || "Untitled review"}</h2></div><button type="button" className="mk-btn" onClick={()=>setSelected(null)}>Close details</button></div><div className={styles.product}><ProductImage review={selected}/><div><strong>{selected.productTitleSnapshot}</strong>{selected.variantTitleSnapshot && <p>{selected.variantTitleSnapshot}</p>}<Stars rating={selected.rating}/></div></div><section><h3>Review</h3><p className={styles.fullBody}>{selected.body || "No written review."}</p></section><dl className={styles.facts}><div><dt>Customer</dt><dd>{selected.customerDisplayName} {selected.verifiedPurchase && <span className="mk-badge mk-badge-success">Verified Purchase</span>}</dd></div><div><dt>Order</dt><dd>{selected.shopifyOrderName || "—"}</dd></div><div><dt>Submitted</dt><dd>{date(selected.submittedAt)}</dd></div><div><dt>Published</dt><dd>{date(selected.publishedAt)}</dd></div><div><dt>Moderated</dt><dd>{date(selected.moderatedAt)}</dd></div></dl>{selected.rejectionReason && <section className={styles.internal}><h3>Internal rejection reason</h3><p>This note is internal only and is never shown to customers.</p><p>{selected.rejectionReason}</p></section>}<div className={styles.actions}>{selected.status !== "PUBLISHED" && <button className="mk-btn mk-btn-primary" disabled={busy} type="button" onClick={()=>void moderate("PUBLISH")}>{busy ? "Updating…" : "Publish"}</button>}{selected.status !== "REJECTED" && <button className="mk-btn" disabled={busy} type="button" onClick={()=>setDialogAction("REJECT")}>Reject</button>}{selected.status !== "PENDING_MODERATION" && <button className="mk-btn" disabled={busy} type="button" onClick={()=>setDialogAction("UNPUBLISH")}>Unpublish</button>}</div></>}</aside>}</>}</section>
    {dialogAction && <div className={styles.backdrop} role="presentation"><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={dialogTitleId}>{dialogAction === "REJECT" ? <><h2 id={dialogTitleId}>Reject this review?</h2><p>The optional reason is internal only and is never shown to the customer.</p><label>Internal rejection reason<textarea value={reason} maxLength={500} onChange={event=>setReason(event.target.value)} placeholder="Optional internal rejection reason" /></label><p className={styles.characterCount}>{reason.length}/500 characters</p><div className={styles.actions}><button ref={cancelButton} className="mk-btn" type="button" disabled={busy} onClick={()=>setDialogAction(null)}>Cancel</button><button className="mk-btn" type="button" disabled={busy} onClick={()=>void moderate("REJECT")}>{busy ? "Rejecting…" : "Reject review"}</button></div></> : <><h2 id={dialogTitleId}>Unpublish this review?</h2><p>This review will be hidden from the storefront and returned to pending moderation.</p><div className={styles.actions}><button ref={cancelButton} className="mk-btn" type="button" disabled={busy} onClick={()=>setDialogAction(null)}>Cancel</button><button className="mk-btn" type="button" disabled={busy} onClick={()=>void moderate("UNPUBLISH")}>{busy ? "Unpublishing…" : "Unpublish review"}</button></div></>}</section></div>}
  </section>;
}
