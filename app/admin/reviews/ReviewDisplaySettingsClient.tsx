"use client";

import { useState } from "react";
import { REVIEW_SORT_VALUES, isReviewSort, type ReviewSort } from "../../../services/reviews/review-sort";

type Settings = { storefrontReviewsEnabled: boolean; showReviewSummary: boolean; showRatingDistribution: boolean; showVerifiedPurchaseBadge: boolean; showReviewDates: boolean; showVariantTitle: boolean; reviewsPerPage: number; defaultReviewSort: ReviewSort };
const booleanSettings = [["storefrontReviewsEnabled", "Enable storefront reviews"], ["showReviewSummary", "Show review summary"], ["showRatingDistribution", "Show rating distribution"], ["showVerifiedPurchaseBadge", "Show verified-purchase badge"], ["showReviewDates", "Show review dates"], ["showVariantTitle", "Show variant title"]] as const;

export default function ReviewDisplaySettingsClient({ initial }: { initial: Settings }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async () => { setState("saving"); try { const response = await fetch("/api/admin/reviews/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) }); if (!response.ok) throw new Error(); setState("saved"); } catch { setState("error"); } };
  const updateSort = (value: string) => { if (isReviewSort(value)) setValue((current) => ({ ...current, defaultReviewSort: value })); };
  return <section style={{ margin: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}><h2>Storefront review display</h2><p>Configure the published reviews shown by the LoopDesk Product Reviews block.</p><div style={{ display: "grid", gap: 8 }}>{booleanSettings.map(([key, label]) => <label key={key}><input type="checkbox" checked={value[key]} onChange={(event) => setValue((current) => ({ ...current, [key]: event.target.checked }))} /> {label}</label>)}<label>Reviews per page <input type="number" min="1" max="25" value={value.reviewsPerPage} onChange={(event) => setValue((current) => ({ ...current, reviewsPerPage: Number(event.target.value) }))} /></label><label>Default sort <select value={value.defaultReviewSort} onChange={(event) => updateSort(event.target.value)}>{REVIEW_SORT_VALUES.map((sort) => <option key={sort} value={sort}>{sort === "NEWEST" ? "Newest" : sort === "HIGHEST_RATING" ? "Highest rating" : "Lowest rating"}</option>)}</select></label></div><button type="button" disabled={state === "saving"} onClick={save} style={{ marginTop: 12 }}>{state === "saving" ? "Saving…" : "Save display settings"}</button>{state === "saved" && <p role="status">Settings saved.</p>}{state === "error" && <p role="alert">Could not save settings.</p>}</section>;
}
