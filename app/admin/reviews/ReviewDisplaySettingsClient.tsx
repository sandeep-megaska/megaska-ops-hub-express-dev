"use client";

import { useState } from "react";
import { REVIEW_SORT_VALUES, isReviewSort, type ReviewSort } from "../../../services/reviews/review-sort";

type Settings = {
  reviewsEnabled: boolean;
  automaticRequestsEnabled: boolean;
  storefrontReviewsEnabled: boolean;
  showReviewSummary: boolean;
  showRatingDistribution: boolean;
  showVerifiedPurchaseBadge: boolean;
  showReviewDates: boolean;
  showVariantTitle: boolean;
  reviewsPerPage: number;
  defaultReviewSort: ReviewSort;
};

const displaySettings = [
  ["showReviewSummary", "Show review summary"],
  ["showRatingDistribution", "Show rating distribution"],
  ["showVerifiedPurchaseBadge", "Show verified-purchase badge"],
  ["showReviewDates", "Show review dates"],
  ["showVariantTitle", "Show variant title"],
] as const;

function SettingToggle({ checked, disabled, label, description, onChange }: { checked: boolean; disabled?: boolean; label: string; description: string; onChange: (checked: boolean) => void }) {
  return <label style={{ display: "grid", gap: 4 }}><span><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /> {label}</span><small>{description}</small></label>;
}

export default function ReviewDisplaySettingsClient({ initial }: { initial: Settings }) {
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const update = <K extends keyof Settings>(key: K, next: Settings[K]) => setValue((current) => ({ ...current, [key]: next }));
  const updateReviewsEnabled = (reviewsEnabled: boolean) => setValue((current) => ({ ...current, reviewsEnabled, automaticRequestsEnabled: reviewsEnabled ? current.automaticRequestsEnabled : false }));
  const save = async () => {
    setState("saving");
    try {
      const response = await fetch("/api/admin/reviews/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value) });
      if (!response.ok) throw new Error();
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const updateSort = (next: string) => { if (isReviewSort(next)) update("defaultReviewSort", next); };

  return <section style={{ margin: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
    <h2>Review settings</h2>
    <div style={{ display: "grid", gap: 12 }}>
      <fieldset style={{ display: "grid", gap: 8 }}>
        <legend>Review module</legend>
        <SettingToggle checked={value.reviewsEnabled} label="Enable customer reviews" description="Allow customers to submit new product reviews. Disabling this stops new review collection but does not delete existing reviews." onChange={updateReviewsEnabled} />
        <SettingToggle checked={value.automaticRequestsEnabled} disabled={!value.reviewsEnabled} label="Enable automatic review requests" description="Automatically schedule review request messages for eligible delivered orders." onChange={(checked) => update("automaticRequestsEnabled", checked)} />
      </fieldset>
      <fieldset style={{ display: "grid", gap: 8 }}>
        <legend>Storefront display</legend>
        <SettingToggle checked={value.storefrontReviewsEnabled} label="Enable storefront reviews" description="Show published reviews in the LoopDesk Product Reviews block on product pages." onChange={(checked) => update("storefrontReviewsEnabled", checked)} />
        {displaySettings.map(([key, label]) => <SettingToggle key={key} checked={value[key]} label={label} description="Choose whether this detail appears in the product reviews block." onChange={(checked) => update(key, checked)} />)}
        <label>Reviews per page <input type="number" min="1" max="25" value={value.reviewsPerPage} onChange={(event) => update("reviewsPerPage", Number(event.target.value))} /></label>
        <label>Default sort <select value={value.defaultReviewSort} onChange={(event) => updateSort(event.target.value)}>{REVIEW_SORT_VALUES.map((sort) => <option key={sort} value={sort}>{sort === "NEWEST" ? "Newest" : sort === "HIGHEST_RATING" ? "Highest rating" : "Lowest rating"}</option>)}</select></label>
      </fieldset>
    </div>
    <button type="button" disabled={state === "saving"} onClick={save} style={{ marginTop: 12 }}>{state === "saving" ? "Saving…" : "Save review settings"}</button>
    {state === "saved" && <p role="status">Settings saved.</p>}
    {state === "error" && <p role="alert">Could not save settings.</p>}
  </section>;
}
