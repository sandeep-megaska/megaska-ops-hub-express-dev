import { NextRequest, NextResponse } from "next/server";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";
import { auditCodAdvance } from "../../../../../services/cod-advance/core";
import { CodAdvanceSettingsValidationError, getCodAdvanceSettingsForShop, updateCodAdvanceSettingsForShop, type CodAdvanceSettingsInput } from "../../../../../services/cod-advance/settings";

export const runtime = "nodejs";

// Identify the tenant from a verified App Bridge session token, never from ?shop=.
async function authenticatedShop(req: NextRequest): Promise<{ id: string; shopDomain: string }> {
  try {
    const shop = await requireAdminShopFromRequest(req);
    return { id: shop.id, shopDomain: shop.shopDomain };
  } catch {
    throw new CodAdvanceSettingsValidationError(["Unable to resolve shop"]);
  }
}

function editableFields(body: Record<string, unknown>): CodAdvanceSettingsInput {
  return {
    enabled: body.enabled as boolean,
    advanceType: body.advanceType as "FIXED" | "PERCENTAGE",
    fixedAdvanceAmountPaise: body.fixedAdvanceAmountPaise as number,
    percentageBasisPoints: body.percentageBasisPoints == null ? null : body.percentageBasisPoints as number,
    minimumAdvanceAmountPaise: body.minimumAdvanceAmountPaise == null ? null : body.minimumAdvanceAmountPaise as number,
    maximumAdvanceAmountPaise: body.maximumAdvanceAmountPaise == null ? null : body.maximumAdvanceAmountPaise as number,
    minOrderAmountPaise: body.minOrderAmountPaise == null ? null : body.minOrderAmountPaise as number,
    maxOrderAmountPaise: body.maxOrderAmountPaise == null ? null : body.maxOrderAmountPaise as number,
    customerTitle: typeof body.customerTitle === "string" && body.customerTitle.trim() ? body.customerTitle.trim() : null,
    customerMessage: typeof body.customerMessage === "string" && body.customerMessage.trim() ? body.customerMessage.trim() : null,
  };
}

function errorResponse(error: unknown) {
  if (error instanceof CodAdvanceSettingsValidationError) return NextResponse.json({ ok: false, error: error.message, issues: error.issues }, { status: error.message === "Unable to resolve shop" ? 401 : 400 });
  return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Partial COD settings failed" }, { status: 500 });
}

export async function GET(req: NextRequest) {
  try {
    const resolved = await authenticatedShop(req);
    const settings = await getCodAdvanceSettingsForShop(resolved.id, { audit: auditCodAdvance });
    return NextResponse.json({ ok: true, settings });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(req: NextRequest) {
  try {
    const resolved = await authenticatedShop(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new CodAdvanceSettingsValidationError(["Invalid JSON payload"]);
    const settings = await updateCodAdvanceSettingsForShop({ shopId: resolved.id, ...editableFields(body) }, { audit: auditCodAdvance });
    return NextResponse.json({ ok: true, settings });
  } catch (error) { return errorResponse(error); }
}

export const POST = PUT;
