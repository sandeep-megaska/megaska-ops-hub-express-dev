import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { buildGstInvoiceHtml, GST_INVOICE_PAPER_GEOMETRY } from "./invoice-html.ts";
import type { GstInvoiceRenderModel } from "./pdf.ts";
import type { GstInvoiceTemplateConfig } from "./template.ts";

// Inlined rather than imported from template.ts: that module reaches the database
// layer at import time, and this test is deliberately I/O-free.
const TEMPLATE_CONFIG: GstInvoiceTemplateConfig = {
  preset: "detailed",
  paperSize: "auto",
  showHeaderLogo: true,
  showFooterLogo: true,
  showSku: true,
  showVariant: true,
  showProductTitle: true,
  showHsn: true,
  showTaxBreakup: true,
  showAmountInWords: true,
  showDeclaration: true,
  showFooterNote: true,
};

// A deliberately unfriendly invoice: many line items (so it must paginate), long
// unbroken descriptions and a long email (so anything that can overflow a narrow page
// box will), and every optional block switched on.
function sampleModel(rowCount = 24): GstInvoiceRenderModel {
  return {
    gstDocumentId: "doc_1",
    templateType: "invoice",
    title: "TAX INVOICE",
    documentNumber: "INV/2026/000123",
    documentDate: "15-09-2026",
    orderNumber: "#MK10432",
    orderDate: "14-09-2026",
    placeOfSupply: "29 - Karnataka",
    supplier: {
      name: "Megaska Retail Private Limited",
      tradeName: "Megaska",
      gstin: "29AABCM1234F1Z5",
      phone: "+91 80 4718 0000",
      email: "accounts.receivable@megaska-retail-operations.example.in",
      lines: ["No. 41, 3rd Floor, 12th Main Road", "HSR Layout Sector 6", "Bengaluru, Karnataka 560102"],
    },
    buyer: {
      name: "Aishwarya Balasubramanian",
      gstin: "29AAACT5678M1ZQ",
      phone: "+91 98450 12345",
      email: "aishwarya.balasubramanian@averylongcustomerdomainname.example.com",
      lines: ["Flat 1204, Tower B, Prestige Lakeside Habitat", "Varthur Main Road, Gunjur", "Bengaluru, Karnataka 560087"],
    },
    shipping: {
      name: "Aishwarya Balasubramanian",
      phone: "+91 98450 12345",
      lines: ["Flat 1204, Tower B, Prestige Lakeside Habitat", "Varthur Main Road, Gunjur", "Bengaluru, Karnataka 560087"],
    },
    rows: Array.from({ length: rowCount }, (_, index) => ({
      lineNumber: String(index + 1),
      sku: `MK-SKU-000${index + 1}-VARIANT-LONGCODE`,
      description: `Handcrafted Brass Memento Trophy with Engraved Presentation Plaque — Edition ${index + 1}`,
      variant: "Gold / 240mm / Rosewood base",
      hsn: "83062920",
      quantity: "2",
      gross: "4,998.00",
      taxable: "4,235.59",
      gstRate: "18",
      cgst: "381.20",
      sgst: "381.20",
      igst: "0.00",
      total: "4,998.00",
    })),
    totals: { taxable: "101,654.16", cgst: "9,148.88", sgst: "9,148.88", igst: "0.00", cess: "0.00", total: "119,951.92" },
    amountInWords: "One Lakh Nineteen Thousand Nine Hundred Fifty One and Ninety Two Paise Only",
    declaration: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
    footer: "This is a system generated GST document.",
    signature: "Authorised Signatory",
    branding: { headerLogoSrc: null, footerLogoSrc: null },
    templateConfig: TEMPLATE_CONFIG,
  };
}

test("the page box follows the selected paper instead of being pinned to A4", () => {
  // The A5 crop this guards against was a hard-coded `@page { size: A4 portrait }`:
  // the layout stayed A4 while the sheet was A5, and the overflow was clipped.
  assert.match(buildGstInvoiceHtml(sampleModel(), "auto"), /@page \{ size: auto; margin: 10mm; \}/);
  assert.match(buildGstInvoiceHtml(sampleModel(), "A4"), /@page \{ size: A4 portrait; margin: 10mm; \}/);
  assert.match(buildGstInvoiceHtml(sampleModel(), "A5"), /@page \{ size: A5 portrait; margin: 8mm; \}/);

  for (const paper of ["auto", "A5"] as const) {
    assert.doesNotMatch(buildGstInvoiceHtml(sampleModel(), paper), /size: A4 portrait/);
  }
});

test("print layout carries no fixed-width or unpaginated content", () => {
  const html = buildGstInvoiceHtml(sampleModel(), "A5");

  // A fixed px width is exactly what overflows a narrower sheet.
  assert.doesNotMatch(html, /\.totals\{ width:\d+px/);
  assert.match(html, /\.totals\{ width:100%; max-width:72mm;/);

  // Long invoices must break across pages with a repeated header row.
  assert.match(html, /thead\{ display:table-header-group; \}/);
  assert.match(html, /tr\{ break-inside:avoid; page-break-inside:avoid; \}/);

  // Narrow sheets get the compact scale, whether pinned or chosen in the print dialog.
  assert.match(html, /@media print and \(max-width: 160mm\)/);
});

test("on-screen preview simulates the sheet the print will use", () => {
  assert.match(buildGstInvoiceHtml(sampleModel(), "A4"), /max-width:794px/);
  assert.match(buildGstInvoiceHtml(sampleModel(), "A5"), /max-width:559px/);
  assert.equal(GST_INVOICE_PAPER_GEOMETRY.A5.pdfFormat, "A5");
  // "auto" has no sheet of its own for a generated file; A4 is the documented fallback.
  assert.equal(GST_INVOICE_PAPER_GEOMETRY.auto.pdfFormat, "A4");
});

// Real-layout check: only runs where a Chromium binary is available (the same one the
// server-side PDF renderer uses). Skipped elsewhere rather than failing the suite.
const chromiumPath = [process.env.GST_PDF_CHROMIUM_EXECUTABLE_PATH, "/opt/pw-browsers/chromium"]
  .filter((candidate): candidate is string => Boolean(candidate))
  .find((candidate) => existsSync(candidate));

test("A5 renders onto A5 pages with nothing clipped off the sheet", { skip: chromiumPath ? false : "no Chromium binary available" }, async () => {
  const { default: puppeteer } = await import("puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: chromiumPath,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    headless: true,
  });

  try {
    for (const paper of ["A4", "A5"] as const) {
      const geometry = GST_INVOICE_PAPER_GEOMETRY[paper];
      const page = await browser.newPage();
      await page.setViewport({ width: geometry.screenWidthPx, height: Math.round(geometry.screenWidthPx * Math.SQRT2) });
      await page.setContent(buildGstInvoiceHtml(sampleModel(), paper), { waitUntil: "load" });
      await page.emulateMediaType("print");

      // Horizontal overflow under print media IS the crop: content wider than the page
      // box is what the printer drops off the right edge of the sheet.
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
      });
      assert.ok(
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `${paper}: content overflows the page box by ${overflow.scrollWidth - overflow.clientWidth}px`,
      );

      const pdf = Buffer.from(await page.pdf({ format: geometry.pdfFormat, printBackground: true, preferCSSPageSize: true })).toString("latin1");

      // The emitted sheet itself, not merely that something rendered. A5 is 420x595pt,
      // A4 595x842pt; Chromium rounds by a fraction of a point, hence the tolerance.
      const mediaBox = pdf.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
      assert.ok(mediaBox, `${paper}: no MediaBox in the generated PDF`);
      const [expectedWidth, expectedHeight] = paper === "A5" ? [420, 595] : [595, 842];
      assert.ok(
        Math.abs(Number(mediaBox[1]) - expectedWidth) <= 2 && Math.abs(Number(mediaBox[2]) - expectedHeight) <= 2,
        `${paper}: expected a ${expectedWidth}x${expectedHeight}pt sheet, got ${mediaBox[1]}x${mediaBox[2]}pt`,
      );

      // 24 line items cannot fit one sheet — the invoice must have paginated rather than
      // losing the overflow off the bottom.
      assert.match(pdf, /\/Count\s+([2-9]|\d{2,})/, `${paper}: expected multiple pages`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
});
