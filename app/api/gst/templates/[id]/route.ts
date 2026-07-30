import { NextRequest, NextResponse } from "next/server";
import { getTemplateById, updateTemplate } from "../../../../../services/gst/template";
import { ShopResolutionError } from "../../../../../services/shopify/shop";
import { requireAdminShopFromRequest } from "../../../../../services/shopify/admin-auth";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const { id } = await context.params;
    const result = await getTemplateById(id, { shopId: shop.id });

    if (!result.ok || !result.data) {
      const status = result.error === "Template not found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, template: result.data }, { status: 200 });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const shop = await requireAdminShopFromRequest(req);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid JSON payload" }, { status: 400 });
    }

    const { id } = await context.params;
    const result = await updateTemplate(
      id,
      {
        templateName: body.templateName !== undefined ? String(body.templateName || "") : undefined,
        isActive: body.isActive !== undefined ? Boolean(body.isActive) : undefined,
        isDefault: body.isDefault !== undefined ? Boolean(body.isDefault) : undefined,
        headerText: body.headerText !== undefined ? (body.headerText ? String(body.headerText) : null) : undefined,
        footerText: body.footerText !== undefined ? (body.footerText ? String(body.footerText) : null) : undefined,
        declarationText:
          body.declarationText !== undefined ? (body.declarationText ? String(body.declarationText) : null) : undefined,
        notesText: body.notesText !== undefined ? (body.notesText ? String(body.notesText) : null) : undefined,
        logoFileUrl: body.logoFileUrl !== undefined ? (body.logoFileUrl ? String(body.logoFileUrl) : null) : undefined,
        themeConfig:
          body.themeConfig !== undefined
            ? body.themeConfig && typeof body.themeConfig === "object" && !Array.isArray(body.themeConfig)
              ? (body.themeConfig as Record<string, unknown>)
              : null
            : undefined,
      },
      { shopId: shop.id },
    );

    if (!result.ok || !result.data) {
      const status = result.error === "Template not found" ? 404 : 400;
      return NextResponse.json({ ok: false, error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, template: result.data }, { status: 200 });
  } catch (error) {
    const status = error instanceof ShopResolutionError ? error.status : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Failed" }, { status });
  }
}
