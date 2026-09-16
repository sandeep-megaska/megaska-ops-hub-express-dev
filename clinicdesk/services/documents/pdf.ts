import {
  pdfMargins,
  runningFooterTemplate,
  runningHeaderTemplate,
  type LetterheadLike,
} from "@/services/letterhead/render";

export type PdfRequest = {
  html: string;
  letterhead: LetterheadLike;
  clinicName: string;
  patientName: string;
  patientNo: string;
  documentTitle: string;
  documentNo?: string | null;
};

/**
 * Renders A4 print-fidelity PDF via headless Chromium.
 *
 * Chromium's own header/footer templates are the only reliable way to repeat a
 * continuation header and page numbers across pages — CSS running elements are
 * not supported. They print on page one as well, which is deliberate: a loose
 * page from a clinical record should always carry the patient's name.
 *
 * Reuses the launch strategy already proven in megaska-ops-hub's GST invoice
 * route: @sparticuz/chromium on Vercel, a local Chromium in development.
 */
export async function renderPdf(request: PdfRequest): Promise<Uint8Array> {
  const puppeteer = await import("puppeteer-core");

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  let launchOptions: Parameters<typeof puppeteer.default.launch>[0];

  if (isServerless) {
    const chromium = (await import("@sparticuz/chromium")).default;
    launchOptions = {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    };
  } else {
    launchOptions = {
      headless: true,
      executablePath:
        process.env.CHROMIUM_PATH ||
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        "/opt/pw-browsers/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    };
  }

  const browser = await puppeteer.default.launch(launchOptions);
  try {
    const page = await browser.newPage();
    await page.setContent(request.html, { waitUntil: "load" });

    // `load` fires before webfonts settle and before lazily-decoded images are
    // painted, and a letterhead logo that misses the print is the one defect
    // she would notice immediately. Wait for both explicitly.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images)
          .filter((image) => !image.complete)
          .map(
            (image) =>
              new Promise<void>((resolve) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => resolve(), { once: true });
              }),
          ),
      );
    });

    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      preferCSSPageSize: false,
      displayHeaderFooter: true,
      headerTemplate: runningHeaderTemplate({
        patientName: request.patientName,
        patientNo: request.patientNo,
        documentTitle: request.documentTitle,
        documentNo: request.documentNo,
      }),
      footerTemplate: runningFooterTemplate(request.clinicName),
      margin: pdfMargins(request.letterhead, true),
    });

    return pdf;
  } finally {
    await browser.close();
  }
}
