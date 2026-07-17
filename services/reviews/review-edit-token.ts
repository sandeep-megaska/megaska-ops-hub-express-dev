import { randomBytes } from "node:crypto";
import { prisma } from "../db/prisma.ts";
import { getReviewSettings } from "./review-settings.ts";
import { hashReviewToken, normalizeReviewToken } from "./review-token.ts";

export type ReviewEditTokenErrorCode = "REVIEW_EDIT_TOKEN_INVALID" | "REVIEW_EDIT_TOKEN_EXPIRED" | "REVIEW_EDIT_TOKEN_REVOKED" | "REVIEW_EDITING_DISABLED" | "REVIEW_EDIT_WINDOW_EXPIRED" | "REVIEW_NOT_FOUND" | "REVIEW_SHOP_MISMATCH";
/* eslint-disable @typescript-eslint/no-explicit-any -- domain services support narrow transaction fakes. */
type Db = any;
export const REVIEW_EDIT_TOKEN_BYTES = 32;
export const editDeadline = (submittedAt: Date, days: number) => new Date(submittedAt.getTime() + days * 86_400_000);

export async function createReviewEditToken({ shopId, reviewId, expiresAt, now = new Date(), db = prisma }: { shopId:string; reviewId:string; expiresAt:Date; now?:Date; db?:Db }) {
  const [review, settings] = await Promise.all([db.productReview.findFirst({ where:{ id:reviewId, shopId }, select:{ id:true } }), getReviewSettings(shopId, db)]);
  if (!review) return { ok:false as const, errorCode:"REVIEW_NOT_FOUND" as const };
  if (!settings.customerReviewEditingEnabled || !settings.allowReviewEditing) return { ok:false as const, errorCode:"REVIEW_EDITING_DISABLED" as const };
  const plaintextToken = randomBytes(REVIEW_EDIT_TOKEN_BYTES).toString("base64url");
  await db.$transaction(async (tx:Db) => { await tx.productReviewEditToken.updateMany({ where:{ shopId, reviewId, revokedAt:null }, data:{ revokedAt:now } }); await tx.productReviewEditToken.create({ data:{ shopId, reviewId, tokenHash:hashReviewToken(plaintextToken), expiresAt } }); });
  return { ok:true as const, token:plaintextToken, expiresAt };
}
export async function revokeReviewEditTokens({ shopId, reviewId, now = new Date(), db = prisma }: {shopId:string;reviewId:string;now?:Date;db?:Db}) { return db.productReviewEditToken.updateMany({where:{shopId,reviewId,revokedAt:null},data:{revokedAt:now}}); }
export async function validateReviewEditToken({ token, shopId, now = new Date(), db = prisma }: {token:unknown;shopId:string;now?:Date;db?:Db}):Promise<{ok:true; tokenRecord:any; review:any; settings:any; editDeadline:Date}|{ok:false;errorCode:ReviewEditTokenErrorCode}> {
  const normalized=normalizeReviewToken(token); if(!normalized) return {ok:false,errorCode:"REVIEW_EDIT_TOKEN_INVALID"};
  const row=await db.productReviewEditToken.findUnique({where:{tokenHash:hashReviewToken(normalized)},include:{review:true}}); if(!row) return {ok:false,errorCode:"REVIEW_EDIT_TOKEN_INVALID"};
  if(row.shopId!==shopId || row.review.shopId!==shopId) return {ok:false,errorCode:"REVIEW_EDIT_TOKEN_INVALID"};
  if(row.revokedAt) return {ok:false,errorCode:"REVIEW_EDIT_TOKEN_REVOKED"}; if(row.expiresAt<=now) return {ok:false,errorCode:"REVIEW_EDIT_TOKEN_EXPIRED"};
  const settings=await getReviewSettings(shopId,db); if(!settings.customerReviewEditingEnabled || !settings.allowReviewEditing) return {ok:false,errorCode:"REVIEW_EDITING_DISABLED"};
  const deadline=editDeadline(row.review.submittedAt,settings.reviewEditWindowDays); if(now>deadline) return {ok:false,errorCode:"REVIEW_EDIT_WINDOW_EXPIRED"};
  return {ok:true,tokenRecord:row,review:row.review,settings,editDeadline:deadline};
}
