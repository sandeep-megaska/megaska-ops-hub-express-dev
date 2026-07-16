import { NextRequest, NextResponse } from "next/server"; import { listAvailablePricingPlans } from "../../../../../services/billing/plans/plan-catalog"; import { adminShop, failure, noStore } from "../plan-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req:NextRequest) { const auth=await adminShop(req); if("response" in auth)return auth.response; try { return NextResponse.json({ok:true,plans:await listAvailablePricingPlans({shopId:auth.shopId,currency:req.nextUrl.searchParams.get("currency")??undefined})},{headers:noStore}); }catch(e){return failure(e);} }
