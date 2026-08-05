"use client";
import { useEffect, useState } from "react";
import { adminAuthHeaders } from "../../../lib/admin-fetch";
type Review={id:string;status:string;rating:number;title:string|null;body:string|null;customerDisplayName:string;verifiedPurchase:boolean;productTitleSnapshot:string;submittedAt:string;rejectionReason:string|null};type Data={reviews:Review[];counts:{pending:number;published:number;rejected:number;total:number}};
const statusBadgeClass=(s:string)=>s==="PUBLISHED"?"mk-badge mk-badge-success":s==="REJECTED"?"mk-badge mk-badge-danger":s==="PENDING_MODERATION"?"mk-badge mk-badge-warning":"mk-badge mk-badge-neutral";
export default function ReviewModerationClient({shop}:{shop:string}){const [status,setStatus]=useState("PENDING_MODERATION"),[search,setSearch]=useState(""),[data,setData]=useState<Data|null>(null),[selected,setSelected]=useState<Review|null>(null),[error,setError]=useState(""),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[reason,setReason]=useState("");const load=async()=>{setLoading(true);try{const r=await fetch(`/api/admin/reviews?shop=${encodeURIComponent(shop)}&status=${status}&search=${encodeURIComponent(search)}`,{cache:"no-store",headers:await adminAuthHeaders()}),b=await r.json();if(!r.ok)throw new Error(b.error||"Could not load reviews.");setData(b)}catch(e){setError(e instanceof Error?e.message:"Could not load reviews.")}finally{setLoading(false)}};useEffect(()=>{const t=setTimeout(load,200);return()=>clearTimeout(t)},[status,search,shop]);const act=async(action:string)=>{if(!selected||busy||!window.confirm(`${action.toLowerCase()} this review?`))return;setBusy(true);try{const r=await fetch(`/api/admin/reviews/${selected.id}/moderate?shop=${encodeURIComponent(shop)}`,{method:"POST",headers:{"content-type":"application/json",...(await adminAuthHeaders())},body:JSON.stringify({action,rejectionReason:reason})});if(!r.ok)throw new Error("Moderation failed.");setReason("");await load()}catch(e){setError(e instanceof Error?e.message:"Moderation failed.")}finally{setBusy(false)}};return (
  <main className="mk-page" style={{padding:24}}>
    <div className="mk-page-header">
      <div>
        <h1 className="mk-page-title">Reviews</h1>
        <p className="mk-page-subtitle">Moderate verified customer feedback and keep your storefront trustworthy.</p>
      </div>
    </div>
    {data&&<section aria-label="Review status summary" className="mk-grid-4">{Object.entries(data.counts).map(([label,value])=><div key={label} className="mk-card mk-stat-card"><p className="mk-stat-value">{value}</p><p className="mk-stat-label">{label}</p></div>)}</section>}
    <div className="mk-header-actions">
      <label className="mk-field">
        <span className="mk-label">Status</span>
        <select className="mk-select" value={status} onChange={e=>setStatus(e.target.value)}>
          <option value="PENDING_MODERATION">Pending</option>
          <option value="PUBLISHED">Published</option>
          <option value="REJECTED">Rejected</option>
          <option value="ALL">All</option>
        </select>
      </label>
      <label className="mk-field">
        <span className="mk-label">Search</span>
        <input className="mk-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, order, or customer" aria-label="Search reviews" />
      </label>
    </div>
    {error&&<div className="mk-alert mk-alert-error" role="alert">{error} <button className="mk-btn mk-btn-sm" onClick={load}>Try again</button></div>}
    {loading?<div className="mk-empty" aria-label="Loading reviews"><p className="mk-empty-title">Loading review cards…</p></div>:data?.reviews.length===0?<div className="mk-empty"><p className="mk-empty-title">No reviews found</p><p>No reviews match these filters. Try a different status or search.</p></div>:<div className="mk-grid-2">
      <div className="mk-list">{data?.reviews.map(r=><button type="button" key={r.id} onClick={()=>setSelected(r)} className="mk-list-row" style={{textAlign:"left",width:"100%",background:selected?.id===r.id?"var(--primary-soft)":undefined}}><div><p className="mk-list-title">{"★".repeat(r.rating)} {r.title||"Untitled review"}</p><p className="mk-list-subtitle">{(r.body||"").slice(0,180)}</p><p className="mk-help">{r.customerDisplayName} {r.verifiedPurchase?"• Verified purchase":""} • {r.productTitleSnapshot}</p></div><span className={statusBadgeClass(r.status)}>{r.status}</span></button>)}</div>
      {selected&&<aside className="mk-card">
        <h2 className="mk-section-title">{selected.title||"Untitled review"}</h2>
        <p>{"★".repeat(selected.rating)}</p>
        <p style={{whiteSpace:"pre-wrap"}}>{selected.body||"No written review."}</p>
        <p><b>Customer:</b> {selected.customerDisplayName} {selected.verifiedPurchase&&"(Verified purchase)"}</p>
        {selected.rejectionReason&&<p><b>Internal rejection reason:</b> {selected.rejectionReason}</p>}
        <div className="mk-field" style={{marginTop:12}}>
          <label className="mk-label" htmlFor="rejection-reason">Internal rejection reason</label>
          <textarea id="rejection-reason" className="mk-textarea" value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} placeholder="Optional internal rejection reason"/>
        </div>
        <div className="mk-header-actions" style={{marginTop:12}}>
          {selected.status!=="PUBLISHED"&&<button className="mk-btn mk-btn-primary" disabled={busy} onClick={()=>act("PUBLISH")}>Publish</button>}
          {selected.status!=="REJECTED"&&<button className="mk-btn mk-btn-danger" disabled={busy} onClick={()=>act("REJECT")}>Reject</button>}
          {selected.status!=="PENDING_MODERATION"&&<button className="mk-btn" disabled={busy} onClick={()=>act("UNPUBLISH")}>Unpublish</button>}
        </div>
      </aside>}
    </div>}
  </main>
)}
