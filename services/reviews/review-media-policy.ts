import type { ReviewSettings } from "./review-settings.ts";

export const REVIEW_MEDIA_POLICY = {
  maxItems: 5, maxPhotos: 5, maxVideos: 1, maxPhotoBytes: 8_388_608, maxVideoBytes: 41_943_040, maxVideoDurationSeconds: 30,
  types: { IMAGE: { mimes: ["image/jpeg", "image/png", "image/webp"], extensions: ["jpg", "jpeg", "png", "webp"] }, VIDEO: { mimes: ["video/mp4", "video/webm"], extensions: ["mp4", "webm"] } },
} as const;
export type ReviewMediaType = keyof typeof REVIEW_MEDIA_POLICY.types;
export type ReviewMediaPolicyError = "REVIEW_MEDIA_DISABLED" | "REVIEW_MEDIA_TYPE_DISABLED" | "REVIEW_MEDIA_TYPE_UNSUPPORTED" | "REVIEW_MEDIA_TOO_LARGE" | "REVIEW_MEDIA_LIMIT_EXCEEDED";
export function classifyReviewMedia(mimeType: unknown, fileName: unknown): { ok: true; type: ReviewMediaType } | { ok: false; errorCode: ReviewMediaPolicyError } {
  if (typeof mimeType !== "string" || typeof fileName !== "string") return { ok: false, errorCode: "REVIEW_MEDIA_TYPE_UNSUPPORTED" };
  const extension = fileName.split(".").pop()?.toLowerCase();
  for (const [type, policy] of Object.entries(REVIEW_MEDIA_POLICY.types) as [ReviewMediaType, (typeof REVIEW_MEDIA_POLICY.types)[ReviewMediaType]][]) if (policy.mimes.includes(mimeType as never) && policy.extensions.includes(extension as never)) return { ok: true, type };
  return { ok: false, errorCode: "REVIEW_MEDIA_TYPE_UNSUPPORTED" };
}
export function validateReviewMediaPolicy(settings: ReviewSettings, input: { mimeType: unknown; fileName: unknown; sizeBytes: unknown; existingItems: number; existingPhotos: number; existingVideos: number }) {
  if (!settings.allowMedia || !settings.reviewMediaEnabled) return { ok: false as const, errorCode: "REVIEW_MEDIA_DISABLED" as const };
  const classified = classifyReviewMedia(input.mimeType, input.fileName); if (!classified.ok) return classified;
  if (classified.type === "IMAGE" && !settings.reviewPhotoUploadsEnabled || classified.type === "VIDEO" && !settings.reviewVideoUploadsEnabled) return { ok: false as const, errorCode: "REVIEW_MEDIA_TYPE_DISABLED" as const };
  const limit = classified.type === "IMAGE" ? settings.reviewMaxPhotoSizeBytes : settings.reviewMaxVideoSizeBytes;
  if (!Number.isInteger(input.sizeBytes) || (input.sizeBytes as number) <= 0 || (input.sizeBytes as number) > limit) return { ok: false as const, errorCode: "REVIEW_MEDIA_TOO_LARGE" as const };
  if (input.existingItems >= Math.min(settings.reviewMaxMediaItems, REVIEW_MEDIA_POLICY.maxItems) || classified.type === "IMAGE" && input.existingPhotos >= REVIEW_MEDIA_POLICY.maxPhotos || classified.type === "VIDEO" && input.existingVideos >= REVIEW_MEDIA_POLICY.maxVideos) return { ok: false as const, errorCode: "REVIEW_MEDIA_LIMIT_EXCEEDED" as const };
  return { ok: true as const, type: classified.type };
}
