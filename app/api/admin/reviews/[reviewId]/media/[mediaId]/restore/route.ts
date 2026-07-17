import { NextRequest, NextResponse } from "next/server";
import { resolveAdminShopFromRequest } from "../../../../../../../../services/shopify/admin-shop-context";
import { moderateReviewMedia } from "../../../../../../../../services/reviews/review-media-moderation";
export async function POST(req:NextRequest,{params}:{params:Promise<{reviewId:string;mediaId:string}>}){const resolved=await resolveAdminShopFromRequest(req);if(!resolved.shop)return NextResponse.json({ok:false,error:"Unauthorized"},{status:401});const {reviewId,mediaId}=await params;const result=await moderateReviewMedia({shopId:resolved.shop.id,reviewId,mediaId,action:"RESTORE"});return NextResponse.json(result,{status:result.ok?200:409});}
