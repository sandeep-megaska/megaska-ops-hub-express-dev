"use client";
import { useEffect,useState } from "react";
import { adminAuthHeaders } from "../../../../lib/admin-fetch";
type Data={metrics:Record<string,{value:number;percentageChange?:number|null;asOf?:string}>;reviewVolumeSeries:{submitted:number;published:number;rejected:number}[]};
const labels:Record<string,string>={reviewsSubmitted:"Reviews submitted",currentPublishedAverageRating:"Current average rating",requestConversionRate:"Request conversion rate",pendingModeration:"Pending moderation",publicationRate:"Publication rate",mediaReviewRate:"Reviews with media",merchantReplyCoverage:"Merchant reply coverage",failedNotifications:"Failed notifications"};
export default function AnalyticsClient({shop}:{shop:string}){const [range,setRange]=useState("30"),[data,setData]=useState<Data|null>(null),[error,setError]=useState("");useEffect(()=>{(async()=>{try{const r=await fetch(`/api/admin/reviews/analytics/overview?shop=${encodeURIComponent(shop)}&range=${range}`,{headers:await adminAuthHeaders()});const x=await r.json();x.ok?setData(x):setError(x.error||"Unable to load analytics.")}catch{setError("Unable to load analytics.")}})()},[range,shop]);return (
  <div className="mk-page">
    <div className="mk-page-header">
      <div>
        <h1 className="mk-page-title">Review analytics</h1>
        <p className="mk-page-subtitle">Operational, engagement, and review-content metrics. Snapshot cards are labelled and are not period comparisons.</p>
      </div>
      <div className="mk-header-actions">
        <label className="mk-field">
          <span className="mk-label">Period</span>
          <select className="mk-select" value={range} onChange={e=>setRange(e.target.value)}>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </select>
        </label>
      </div>
    </div>
    {error&&<div className="mk-alert mk-alert-error" role="alert">{error}</div>}
    {!data?<p className="mk-help" aria-busy="true">Loading analytics…</p>:<>
      <section className="mk-grid-4">
        {Object.entries(data.metrics).map(([key,metric])=>(
          <div key={key} className="mk-card mk-stat-card">
            <p className="mk-stat-label">{labels[key]}</p>
            <p className="mk-stat-value">{typeof metric.value==="number"?metric.value.toFixed(key.includes("rate")||key.includes("coverage")?2:0):"Unavailable"}</p>
            <p className="mk-stat-meta">{metric.asOf?"Current snapshot":"Selected-period event metric"}{metric.percentageChange===null?" · Prior comparison unavailable":metric.percentageChange!==undefined?` · ${metric.percentageChange.toFixed(1)}% vs prior period`:""}</p>
          </div>
        ))}
      </section>
      <section className="mk-card">
        <h2 className="mk-section-title">Review volume</h2>
        <p className="mk-section-subtitle" aria-label="Review volume chart summary">Submitted {data.reviewVolumeSeries[0]?.submitted??0}; published {data.reviewVolumeSeries[0]?.published??0}; rejected {data.reviewVolumeSeries[0]?.rejected??0}.</p>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <caption>Accessible review volume data</caption>
            <thead><tr><th>Submitted</th><th>Published</th><th>Rejected</th></tr></thead>
            <tbody>{data.reviewVolumeSeries.map((v,i)=><tr key={i}><td>{v.submitted}</td><td>{v.published}</td><td>{v.rejected}</td></tr>)}</tbody>
          </table>
        </div>
      </section>
    </>}
  </div>
)}
