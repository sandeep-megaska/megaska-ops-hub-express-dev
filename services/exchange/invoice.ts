import { prisma } from "../db/prisma";
import { sendExchangeInvoiceEmail } from "../notifications/exchange";

const DEFAULT_GST_RATE = Number(process.env.REVERSE_PICKUP_GST_RATE || "18");
const PRICE_INCLUDES_GST = String(process.env.REVERSE_PICKUP_PRICE_INCLUDES_GST || "true").toLowerCase() !== "false";
const SHOP_STATE = String(process.env.MEGASKA_SHOP_STATE || "KARNATAKA").trim().toUpperCase();

type InvoiceStatus = "GENERATED" | "SENT" | "CANCELLED";

function paiseSplit(totalPaise: number, gstRatePercent: number) {
  const taxable = PRICE_INCLUDES_GST ? Math.round((totalPaise * 100) / (100 + gstRatePercent)) : totalPaise;
  const gst = totalPaise - taxable;
  return { taxable, gst };
}

function financialYear(date: Date) {
  return date.getUTCMonth() >= 3 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;
}

async function nextInvoiceNumber(now: Date) {
  const fy = financialYear(now);
  const prefix = `EX-RP-${fy}-`;
  const latest = await prisma.exchangePaymentInvoice.findFirst({
    where: { invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const seq = latest ? Number(latest.invoiceNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

export async function ensureReversePickupInvoice(requestPaymentId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.exchangePaymentInvoice.findUnique({ where: { requestPaymentId } });
    if (existing) return existing;

    const payment = await tx.requestPayment.findUnique({
      where: { id: requestPaymentId },
      include: { request: { include: { customerProfile: true } } },
    });

    if (!payment || payment.status !== "PAID" || payment.purpose !== "REVERSE_PICKUP_FEE") {
      throw new Error("Invoice can only be generated for PAID reverse pickup fee payment.");
    }

    const invoiceDate = new Date();
    const invoiceNumber = await nextInvoiceNumber(invoiceDate);
    const { taxable, gst } = paiseSplit(payment.amount, DEFAULT_GST_RATE);
    const customerState = (payment.request.customerProfile?.stateProvince || "").trim().toUpperCase();
    const sameState = customerState && SHOP_STATE && customerState === SHOP_STATE;
    const cgstPaise = sameState ? Math.round(gst / 2) : 0;
    const sgstPaise = sameState ? gst - cgstPaise : 0;
    const igstPaise = sameState ? 0 : gst;

    return tx.exchangePaymentInvoice.create({
      data: {
        requestPaymentId: payment.id,
        requestId: payment.requestId,
        invoiceNumber,
        invoiceDate,
        invoiceStatus: "GENERATED",
        customerName: payment.request.customerNameSnapshot || payment.request.customerProfile?.fullName || "Customer",
        customerPhone: payment.request.customerPhoneSnapshot,
        customerEmail: payment.request.customerEmailSnapshot,
        orderNumber: payment.request.orderNumber,
        description: "Reverse pickup fee for exchange request",
        amountPaise: payment.amount,
        taxableAmountPaise: taxable,
        gstRatePercent: DEFAULT_GST_RATE,
        cgstPaise,
        sgstPaise,
        igstPaise,
        totalPaise: payment.amount,
        currency: payment.currency,
        htmlSnapshot: `<h1>Invoice ${invoiceNumber}</h1><p>Reverse pickup fee for exchange request</p><p>Total: ₹${(payment.amount / 100).toFixed(2)}</p>`,
      },
    });
  });
}

export async function sendReversePickupInvoiceEmail(requestPaymentId: string) {
  const invoice = await ensureReversePickupInvoice(requestPaymentId);
  await sendExchangeInvoiceEmail(invoice);
  return prisma.exchangePaymentInvoice.update({
    where: { id: invoice.id },
    data: { invoiceStatus: "SENT" as InvoiceStatus, sentAt: new Date() },
  });
}
