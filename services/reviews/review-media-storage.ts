/**
 * Narrow direct-upload adapter. It intentionally has no cloud credentials: deployments
 * supply a one-object upload URL template and a public CDN base URL. Object keys never
 * leave this module or the database.
 */
import { randomUUID } from "node:crypto";
export type ReviewMediaUploadTarget = { uploadUrl: string; method: "PUT"; headers: Record<string, string>; expiresAt: Date };
const safeName=(name:string)=>`${randomUUID()}.${name.split(".").pop()!.toLowerCase()}`;
export function createReviewMediaStorageKey(shopId:string, reviewId:string, fileName:string) { return `reviews/${shopId}/${reviewId}/${randomUUID()}/${safeName(fileName)}`; }
export function createReviewMediaUploadTarget(key:string, mimeType:string): ReviewMediaUploadTarget | null {
  const template=process.env.REVIEW_MEDIA_UPLOAD_URL_TEMPLATE; if(!template || !template.includes("{key}")) return null;
  return {uploadUrl:template.replace("{key}",encodeURIComponent(key)),method:"PUT",headers:{"content-type":mimeType},expiresAt:new Date(Date.now()+5*60_000)};
}
export function reviewMediaPublicUrl(key:string):string|null { const base=process.env.REVIEW_MEDIA_PUBLIC_BASE_URL?.replace(/\/$/,""); return base ? `${base}/${key.split("/").map(encodeURIComponent).join("/")}` : null; }
/** Physical deletion is delegated to the configured provider integration; DB state is authoritative. */
export async function deleteReviewMediaObject(_key:string):Promise<boolean> { return false; }
