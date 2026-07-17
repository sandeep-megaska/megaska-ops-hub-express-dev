"use client";

import { useState } from "react";
import { REVIEW_SORT_VALUES, isReviewSort, type ReviewSort } from "../../../services/reviews/review-sort";

type Settings = {
  storefrontReviewsEnabled: boolean;
  showReviewSummary: boolean;
  showRatingDistribution: boolean;
  showVerifiedPurchaseBadge: boolean;
  showReviewDates: boolean;
  showVariantTitle: boolean;
  reviewsPerPage: number;
  defaultReviewSort: ReviewSort;
};

const booleanSettings = [
  ["storefrontReviewsEnabled", "Enable storefront reviews"],
  ["showReviewSummary", "Show review summary"],
  ["showRatingDistribution", "Show rating distribution"],
  ["showVerifiedPurchaseBadge", "Show verified-purchase badge"],
  ["showReviewDates", "Show review dates"],
  ["showVariantTitle", "Show variant title"],
] as const;

export default function ReviewDisplaySettingsClient({ initial }: { initial: Settings }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async () => {
    setState("saving");

    try {
      const response = await fetch("/api/admin/reviews/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value),
      });

      if (!response.ok) throw new Error();
      setState("saved");
    } catch {
      setState("error");
    }
  };

  const updateSort = (nextSort: string) => {
    if (isReviewSort(nextSort)) {
      setValue((current) => ({ ...current, defaultReviewSort: nextSort }));
    }
  };

  return <section className="mk-card" aria-labelledby="review-settings-title"><h2 id="review-settings-title" className="mk-section-title">Storefront review display</h2><p className="mk-section-subtitle">Configure the published reviews shown by the LoopDesk Product Reviews block.</p><div className="grid gap-3 md:grid-cols-2">{booleanSettings.map(([key, label]) => <label key={key} className="flex items-center gap-2 rounded-lg border border-gray-200 p-3 text-sm"><input type="checkbox" checked={value[key]} onChange={(event) => setValue((current) => ({ ...current, [key]: event.target.checked }))} />{label}</label>)}<label className="grid gap-1 text-sm font-medium">Reviews per page<input className="rounded-lg border border-gray-300 px-3 py-2" type="number" min="1" max="25" value={value.reviewsPerPage} onChange={(event) => setValue((current) => ({ ...current, reviewsPerPage: Number(event.target.value) }))} /></label><label className="grid gap-1 text-sm font-medium">Default sort<select className="rounded-lg border border-gray-300 px-3 py-2" value={value.defaultReviewSort} onChange={(event) => updateSort(event.target.value)}>{REVIEW_SORT_VALUES.map((sort) => <option key={sort} value={sort}>{sort === "NEWEST" ? "Newest" : sort === "HIGHEST_RATING" ? "Highest rating" : "Lowest rating"}</option>)}</select></label></div><button type="button" disabled={state === "saving"} onClick={save} className="mk-btn mk-btn-primary mt-4">{state === "saving" ? "Saving…" : "Save display settings"}</button>{state === "saved" && <p className="mt-3 text-sm text-green-800" role="status">Settings saved.</p>}{state === "error" && <p className="mt-3 text-sm text-red-800" role="alert">Could not save settings. Please try again.</p>}</section>;
}
