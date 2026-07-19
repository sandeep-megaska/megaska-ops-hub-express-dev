export type PublicReviewMedia = { type: "IMAGE" | "VIDEO"; url: string; thumbnailUrl: string | null; width: number | null; height: number | null; durationSeconds: number | null; sortOrder: number };
export type ReviewMediaPublicProjectionInput = { mediaType: "IMAGE" | "VIDEO"; status: string; publicUrl: string | null; thumbnailUrl: string | null; width: number | null; height: number | null; durationSeconds: number | null; sortOrder: number; deletedAt: Date | null };
export function projectPublicReviewMedia(media: ReviewMediaPublicProjectionInput[]): PublicReviewMedia[] {
  return media.filter(item => item.status === "READY" && !item.deletedAt && !!item.publicUrl).sort((a, b) => a.sortOrder - b.sortOrder).map(item => ({ type: item.mediaType, url: item.publicUrl!, thumbnailUrl: item.thumbnailUrl, width: item.width, height: item.height, durationSeconds: item.durationSeconds, sortOrder: item.sortOrder }));
}
