import { NextRequest, NextResponse } from "next/server";
import { getActiveGstSettings } from "../../../../../services/gst/settings";
import { resolveGstAdminShopId } from "../../../../../services/gst/request-shop";
import { createTemplate, listTemplates, resolveGstInvoiceTemplateConfig, updateTemplate } from "../../../../../services/gst/template";

export const runtime = "nodejs";

const DEFAULT_TEMPLATE_NAME = "Default GST Template";

async function getOrCreateDefaultTemplate(shopId: string) {
  const settings = await getActiveGstSettings({ shopId });
  if (!settings.ok || !settings.data) {
    return { ok: false as const, error: settings.error || "No active GST settings configured" };
  }

  const list = await listTemplates(settings.data.id);
  if (!list.ok) {
    return { ok: false as const, error: list.error || "Failed to list templates" };
  }

  const existing = (list.data || []).find((template) => template.isDefault) || (list.data || [])[0];
  if (existing) return { ok: true as const, template: existing };

  const created = await createTemplate({ gstSettingsId: settings.data.id, templateName: DEFAULT_TEMPLATE_NAME, isDefault: true });
  if (!created.ok || !created.data) {
    return { ok: false as const, error: created.error || "Failed to create default template" };
  }

  return { ok: true as const, template: created.data };
}

export async function GET(req: NextRequest) {
  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });

  const resolved = await getOrCreateDefaultTemplate(shopId);
  if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });
  return NextResponse.json({ ok: true, template: resolved.template }, { status: 200 });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });

  const shopId = await resolveGstAdminShopId(req);
  if (!shopId) return NextResponse.json({ ok: false, error: "Unable to resolve shop for this request" }, { status: 400 });

  const resolved = await getOrCreateDefaultTemplate(shopId);
  if (!resolved.ok) return NextResponse.json({ ok: false, error: resolved.error }, { status: 400 });

  const existingThemeConfig = resolved.template.themeConfig || {};
  const incomingThemeConfig =
    body.themeConfig !== undefined && body.themeConfig && typeof body.themeConfig === "object" && !Array.isArray(body.themeConfig)
      ? (body.themeConfig as Record<string, unknown>)
      : body.themeConfig === null
        ? {}
        : null;

  const nextThemeConfig = incomingThemeConfig
    ? {
        ...existingThemeConfig,
        ...incomingThemeConfig,
        invoiceTemplate: resolveGstInvoiceTemplateConfig(incomingThemeConfig),
      }
    : undefined;

  const result = await updateTemplate(resolved.template.id, {
    themeConfig: nextThemeConfig,
  });

  if (!result.ok || !result.data) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, template: result.data }, { status: 200 });
}
