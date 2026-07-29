import { NextRequest, NextResponse } from "next/server";
import { createTemplate, listTemplates } from "../../../../services/gst/template";
import { getActiveGstSettings, getGstSettingsById } from "../../../../services/gst/settings";
import { resolveGstAdminShopId } from "../../../../services/gst/request-shop";

export const runtime = "nodejs";

// Resolve the gstSettings id to operate on, always bound to the acting shop.
// An explicit gstSettingsId is honoured only if it belongs to this shop, so a
// client cannot target another tenant's settings by supplying its id.
async function resolveSettingsId(explicitId: string | null | undefined, shopId: string): Promise<{ id?: string; error?: string }> {
  if (explicitId && explicitId.trim()) {
    const byId = await getGstSettingsById(explicitId.trim());
    if (!byId.ok || !byId.data || String(byId.data.shopId || "") !== shopId) {
      return { error: "GST settings not found" };
    }
    return { id: byId.data.id };
  }

  const active = await getActiveGstSettings({ shopId });
  if (!active.ok || !active.data) {
    return { error: active.error || "No active GST settings configured" };
  }

  return { id: active.data.id };
}

export async function GET(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });
  }

  const settings = await resolveSettingsId(req.nextUrl.searchParams.get("gstSettingsId"), shopId);
  if (!settings.id) {
    return NextResponse.json({ ok: false, error: settings.error }, { status: 400 });
  }

  const result = await listTemplates(settings.id);
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, templates: result.data }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
  }

  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) {
    return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });
  }

  const settings = await resolveSettingsId(
    body.gstSettingsId ? String(body.gstSettingsId) : req.nextUrl.searchParams.get("gstSettingsId"),
    shopId,
  );
  if (!settings.id) {
    return NextResponse.json({ ok: false, error: settings.error }, { status: 400 });
  }

  const result = await createTemplate({
    gstSettingsId: settings.id,
    templateName: String(body.templateName || ""),
    isDefault: body.isDefault === true,
    headerText: body.headerText ? String(body.headerText) : null,
    footerText: body.footerText ? String(body.footerText) : null,
    declarationText: body.declarationText ? String(body.declarationText) : null,
    notesText: body.notesText ? String(body.notesText) : null,
    logoFileUrl: body.logoFileUrl ? String(body.logoFileUrl) : null,
    themeConfig:
      body.themeConfig && typeof body.themeConfig === "object" && !Array.isArray(body.themeConfig)
        ? (body.themeConfig as Record<string, unknown>)
        : null,
  });

  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, template: result.data }, { status: 201 });
}
