import { NextRequest, NextResponse } from "next/server";
import { PlanCatalogError } from "../../../../services/billing/plans/plan-catalog";
import { PlanLifecycleError } from "../../../../services/billing/plans/plan-lifecycle";
import { formatAdminShopResolutionError, resolveAdminShopFromRequest } from "../../../../services/shopify/admin-shop-context";
export const runtime="nodejs"; export const dynamic="force-dynamic"; export const noStore={"Cache-Control":"no-store, private"};
export async function adminShop(req: NextRequest) { const resolved=await resolveAdminShopFromRequest(req); if (!resolved.shop?.id) return { response: NextResponse.json({ok:false,error:formatAdminShopResolutionError(resolved)},{status:401,headers:noStore}) }; return { shopId:resolved.shop.id }; }
export async function body(req: NextRequest) { try { return await req.json() as Record<string,unknown>; } catch { return {}; } }
export function failure(error: unknown) { const code=error instanceof PlanLifecycleError || error instanceof PlanCatalogError ? error.code : "PLAN_LIFECYCLE_FAILED"; const status=/NOT_FOUND/.test(code)?404:/PENDING|ALREADY|NOT_ACTIVE|NOT_ALLOWED|REQUIRED/.test(code)?409:400; return NextResponse.json({ok:false,error:code},{status,headers:noStore}); }
