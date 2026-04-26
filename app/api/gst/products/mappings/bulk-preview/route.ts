import { NextRequest, NextResponse } from "next/server";
import { previewBulkProductTaxMappings } from "../../../../../../services/gst/product-tax-bulk";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ ok: false, data: null, error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await previewBulkProductTaxMappings(
    Array.isArray(body.rows) ? body.rows.map((row) => row as { sku: string; hsnCode: string; slabId?: string; taxRate?: number }) : []
  );

  if (!result.ok) {
    return NextResponse.json({ ok: false, data: null, error: result.error || "Failed to preview bulk mapping" }, { status: 400 });
  }

  return NextResponse.json({ ok: true, data: result.data, error: null });
}
