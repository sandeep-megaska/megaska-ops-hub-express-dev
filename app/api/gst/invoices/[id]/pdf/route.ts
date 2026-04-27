import { NextRequest, NextResponse } from "next/server";
import { renderGstInvoicePdfBuffer } from "../../../../../../services/gst/pdf-binary";
import { renderGstPdf } from "../../../../../../services/gst/pdf";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = req.nextUrl.searchParams.get("format");

  if (format === "html") {
    const htmlResult = await renderGstPdf(id);
    if (!htmlResult.ok || !htmlResult.data) {
      return NextResponse.json({ ok: false, error: htmlResult.error || "Unable to render invoice HTML" }, { status: 404 });
    }

    return new NextResponse(htmlResult.data.html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await renderGstInvoicePdfBuffer(id);
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Unable to generate invoice PDF" }, { status: 404 });
  }

  const filename = `${result.data.documentNumber || `gst-invoice-${id}`}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-");
  return new NextResponse(result.data.buffer as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
