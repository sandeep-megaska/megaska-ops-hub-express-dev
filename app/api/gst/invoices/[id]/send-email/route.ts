import { NextRequest, NextResponse } from "next/server";
import { getGstInvoiceById } from "../../../../../../services/gst/invoice";
import { renderGstInvoicePdfBuffer } from "../../../../../../services/gst/pdf-binary";
import { sendCustomerEmail } from "../../../../../../services/notifications/email";
import { extensionCorsPreflight, withExtensionCors } from "../../../../../../services/shopify/extension-cors";

export const runtime = "nodejs";

function normalizeEmail(value: unknown) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function OPTIONS(req: NextRequest) {
  return extensionCorsPreflight(req);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const invoiceResult = await getGstInvoiceById(id);
  if (!invoiceResult.ok || !invoiceResult.data) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: invoiceResult.error || "GST invoice not found" }, { status: 404 }),
      req,
    );
  }

  const invoice = invoiceResult.data;
  const gstSettings = invoice.gstSettings as { shopId?: string | null } | undefined;
  const shopId = gstSettings?.shopId ? String(gstSettings.shopId) : null;
  if (!shopId) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "Unable to resolve shop for this invoice" }, { status: 400 }),
      req,
    );
  }

  const snapshot = invoice.jsonSnapshot && typeof invoice.jsonSnapshot === "object"
    ? (invoice.jsonSnapshot as Record<string, unknown>)
    : {};
  const buyer = snapshot.buyer && typeof snapshot.buyer === "object" ? (snapshot.buyer as Record<string, unknown>) : {};

  const recipient = normalizeEmail(body?.to) || normalizeEmail(buyer.email);
  if (!recipient) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "No customer email address available for this order" }, { status: 400 }),
      req,
    );
  }

  const pdfResult = await renderGstInvoicePdfBuffer(id);
  if (!pdfResult.ok || !pdfResult.data) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: pdfResult.error || "Unable to generate invoice PDF" }, { status: 500 }),
      req,
    );
  }

  const documentNumber = String(invoice.documentNumber || "");
  const filename = `${documentNumber || `gst-invoice-${id}`}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, "-");

  const result = await sendCustomerEmail({
    shopId,
    to: recipient,
    eventType: "ORDER",
    subject: `Your GST Invoice ${documentNumber}`.trim(),
    text: `Please find attached your GST tax invoice ${documentNumber}.\n\nThank you for your order.`,
    attachments: [{ filename, content: pdfResult.data.buffer.toString("base64") }],
    usageContext: { sourceType: "GST_INVOICE", sourceId: id },
  });

  if (result.skipped) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: `Email not sent: ${result.reason}` }, { status: 422 }),
      req,
    );
  }
  if (!result.success) {
    return withExtensionCors(
      NextResponse.json({ ok: false, error: "Failed to send invoice email" }, { status: 502 }),
      req,
    );
  }

  return withExtensionCors(
    NextResponse.json({ ok: true, data: { messageId: result.messageId, to: recipient } }),
    req,
  );
}
