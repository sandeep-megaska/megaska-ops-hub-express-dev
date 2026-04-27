import { NextRequest, NextResponse } from "next/server";
import { prisma } from "../../../../services/db/prisma";
import { getShopDomainFromRequest, resolveShopConfig } from "../../../../services/shopify/shop";
import { createTemplate, updateTemplate, resolveTemplateForOrder } from "../../../../services/gst/template";

export const runtime = "nodejs";

async function getActiveSettingsId(req: NextRequest) {
  const shopDomain = getShopDomainFromRequest(req);
  const shop = await resolveShopConfig(shopDomain);

  const settings = await prisma.gstSettings.findFirst({
    where: { isActive: true, shopId: shop.id ?? null },
    orderBy: { updatedAt: "desc" },
  });

  return settings?.id || null;
}

export async function GET(req: NextRequest) {
  const gstSettingsId = await getActiveSettingsId(req);
  if (!gstSettingsId) {
    return NextResponse.json({ ok: false, error: "No GST settings" }, { status: 400 });
  }

  const result = await resolveTemplateForOrder({ gstSettingsId });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { template: result.data } });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const gstSettingsId = await getActiveSettingsId(req);
  if (!gstSettingsId) {
    return NextResponse.json({ ok: false, error: "No GST settings" }, { status: 400 });
  }

  const existing = await resolveTemplateForOrder({ gstSettingsId });

  if (existing.ok && existing.data) {
    const updated = await updateTemplate(existing.data.id, {
      headerText: body.headerText as string | undefined,
      footerText: body.footerText as string | undefined,
      declarationText: body.declarationText as string | undefined,
      notesText: body.notesText as string | undefined,
      logoFileUrl: body.logoFileUrl as string | undefined,
      themeConfig: body.themeConfig as Record<string, unknown> | undefined,
    });

    if (!updated.ok) {
      return NextResponse.json({ ok: false, error: updated.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, data: { template: updated.data } });
  }

  const created = await createTemplate({
    gstSettingsId,
    templateName: "Default",
    isDefault: true,
    headerText: body.headerText as string | undefined,
    footerText: body.footerText as string | undefined,
    declarationText: body.declarationText as string | undefined,
    notesText: body.notesText as string | undefined,
    logoFileUrl: body.logoFileUrl as string | undefined,
    themeConfig: body.themeConfig as Record<string, unknown> | undefined,
  });

  if (!created.ok) {
    return NextResponse.json({ ok: false, error: created.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: { template: created.data } });
}
