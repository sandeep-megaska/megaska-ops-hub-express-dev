import { NextRequest, NextResponse } from "next/server"; import { reactivateSubscription } from "../../../../../../services/billing/plans/plan-lifecycle"; import { adminShop, body, failure, noStore } from "../../plan-route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req:NextRequest){const a=await adminShop(req);if("response"in a)return a.response;try{const b=await body(req);if(typeof b.merchantSubscriptionId!=="string")throw new Error();return NextResponse.json({ok:true,result:await reactivateSubscription({shopId:a.shopId,merchantSubscriptionId:b.merchantSubscriptionId})},{headers:noStore});}catch(e){return failure(e);}}
