export const REVIEW_SORT_VALUES = [
  "NEWEST",
  "HIGHEST_RATING",
  "LOWEST_RATING",
] as const;

export type ReviewSort = (typeof REVIEW_SORT_VALUES)[number];

function tupleIncludes<T extends readonly string[]>(values: T, value: string): value is T[number] {
  return values.some((candidate) => candidate === value);
}

export function isReviewSort(value: unknown): value is ReviewSort {
  return typeof value === "string" && tupleIncludes(REVIEW_SORT_VALUES, value);
}

export function normalizeReviewSort(
  value: unknown,
  fallback: ReviewSort = "NEWEST",
): ReviewSort {
  return isReviewSort(value) ? value : fallback;
}
