import { NextRequest, NextResponse } from "next/server";
import { renderGstPdf } from "../../../../../../services/gst/pdf";
import { renderGstInvoicePdfBuffer } from "../../../../../../services/gst/pdf-binary";

export const runtime = "nodejs";

// Generic renderer for any GstDocument (tax invoice, credit note, debit note).
//   ?format=html -> printable HTML page (view in a tab)
//   ?format=pdf  -> PDF file download
//   (no format)  -> JSON payload (backward compatible)
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const format = req.nextUrl.searchParams.get("format");

  if (format === "html") {
    const htmlResult = await renderGstPdf(id);
    if (!htmlResult.ok || !htmlResult.data) {
      return NextResponse.json({ ok: false, error: htmlResult.error || "Unable to render document HTML" }, { status: 404 });
    }
    return new NextResponse(htmlResult.data.html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  if (format === "pdf") {
    const pdfResult = await renderGstInvoicePdfBuffer(id);
    if (!pdfResult.ok || !pdfResult.data) {
      return NextResponse.json({ ok: false, error: pdfResult.error || "Unable to generate document PDF" }, { status: 404 });
    }
    const filename = `${pdfResult.data.documentNumber || `gst-document-${id}`}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-");
    return new NextResponse(pdfResult.data.buffer as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const result = await renderGstPdf(id);
  if (!result.ok || !result.data) {
    return NextResponse.json({ ok: false, error: result.error || "Unable to render PDF payload" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, pdf: result.data });
}
