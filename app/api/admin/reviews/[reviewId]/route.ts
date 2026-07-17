import { NextRequest, NextResponse } from "next/server";
import { getAdminReview } from "../../../../../services/reviews/review-admin-query";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../../services/shopify/admin-shop-context";
export const runtime="nodejs"; const headers={"Cache-Control":"no-store"};
export async function GET(req:NextRequest,context:{params:Promise<{reviewId:string}>}){const resolved=await resolveAdminShopFromRequest(req);if(!resolved.shop?.id)return NextResponse.json({ok:false,error:formatAdminShopResolutionError(resolved)},{status:401,headers});const {reviewId}=await context.params;const review=await getAdminReview(resolved.shop.id,reviewId);return review?NextResponse.json({ok:true,review},{headers}):NextResponse.json({ok:false,error:"Review not found."},{status:404,headers});}
