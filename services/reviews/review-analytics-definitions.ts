/** Canonical, deliberately conservative definitions for the merchant review dashboard. */
export const REVIEW_ANALYTICS_DEFINITIONS = {
  reviewsSubmitted: "Reviews with submittedAt in the selected range.",
  reviewsPublished: "Reviews with publishedAt in the selected range.",
  reviewsRejected: "Reviews with rejectedAt in the selected range.",
  currentlyPublished: "Current snapshot of reviews whose status is PUBLISHED.",
  publicationRate: "Published outcomes divided by published plus rejected outcomes in the selected range.",
  requestConversion: "Unique requests submitted divided by unique requests whose initial delivery succeeded.",
  media: "Media excludes deleted items; public media also requires READY and approved.",
  replyCoverage: "Current published reviews with one merchant reply divided by current published reviews.",
  reminder: "A submission after a reminder is observational and is not attributed to that reminder.",
} as const;

export const REVIEW_ANALYTICS_THRESHOLDS = { moderationSlaHours: 48, productRatingMinimum: 3, productLowConversion: 0.1 } as const;
export type MetricComparison = { value:number; previousValue:number; absoluteChange:number; percentageChange:number|null };
export type SnapshotMetric = { value:number; asOf:string };
