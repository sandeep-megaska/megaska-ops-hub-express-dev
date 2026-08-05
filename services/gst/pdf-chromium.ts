import type { Browser } from "puppeteer-core";
import puppeteer from "puppeteer-core";
import { renderGstPdf } from "./pdf";
import type { GstServiceResult } from "./types";
import { gstPerfLog, gstPerfNow } from "./perf";

// PROOF OF CONCEPT — headless-Chromium PDF renderer.
//
// This pipes the SAME HTML that renderGstPdf() already produces (and that the
// browser-side "Print" popup renders correctly on screen) through headless
// Chromium's real layout engine to emit a true .pdf. The point of the POC is to
// confirm it (a) removes the portrait truncation that the hand-drawn pdf-binary.ts
// suffers from, and (b) is fast enough on a warm serverless instance to be worth
// the added bundle/memory cost. It is wired behind ?format=chromium only, so the
// existing hand-drawn path is untouched and we can A/B the two.

// A Chromium launch costs ~1-3s cold. On serverless, one function instance serves
// many sequential requests, so we keep ONE browser per warm instance and only pay
// the launch once. A page is opened and closed per render; the browser persists.
let browserPromise: Promise<Browser> | null = null;

async function resolveLaunchOptions(): Promise<{
  executablePath: string;
  args: string[];
  headless: boolean;
}> {
  // Local/dev override: point at any Chrome/Chromium on the box (e.g. the sandbox's
  // /opt/pw-browsers/chromium). @sparticuz/chromium's bundled binary is Linux-x64
  // only, so an explicit path is how you test off-Lambda.
  const override = String(process.env.GST_PDF_CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (override) {
    return {
      executablePath: override,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--font-render-hinting=none",
      ],
      headless: true,
    };
  }

  // Serverless (Vercel/Lambda): @sparticuz/chromium ships a size-optimized Chromium
  // and the exact flags it needs. Imported lazily so local runs that use the
  // override above never touch it.
  const { default: chromium } = await import("@sparticuz/chromium");
  return {
    executablePath: await chromium.executablePath(),
    args: chromium.args,
    headless: true,
  };
}

async function getBrowser(): Promise<Browser> {
  const existing = browserPromise;
  if (existing) {
    const browser = await existing;
    if (browser.connected) return browser;
    // A previous instance crashed/disconnected — drop it and relaunch below.
    browserPromise = null;
  }

  const launch = (async () => {
    const opts = await resolveLaunchOptions();
    return puppeteer.launch({
      executablePath: opts.executablePath,
      args: opts.args,
      headless: opts.headless,
      defaultViewport: { width: 794, height: 1123 }, // A4 portrait @ ~96dpi
    });
  })();

  browserPromise = launch;
  try {
    return await launch;
  } catch (error) {
    // Don't cache a failed launch — the next call retries from scratch.
    browserPromise = null;
    throw error;
  }
}

export async function renderGstPdfBinary(
  gstDocumentId: string,
): Promise<GstServiceResult<{ documentNumber: string; buffer: Buffer }>> {
  const startedAtMs = gstPerfNow();

  // Reuse the existing HTML renderer verbatim — no template divergence. Logos are
  // already resolved to data URIs (see #785), so the page needs no network at all.
  const htmlResult = await renderGstPdf(gstDocumentId);
  if (!htmlResult.ok || !htmlResult.data) {
    return { ok: false, error: htmlResult.error || "GST document not found" };
  }

  const { html, documentNumber } = htmlResult.data;

  let page: Awaited<ReturnType<Browser["newPage"]>> | null = null;
  try {
    const launchStartedAtMs = gstPerfNow();
    const browser = await getBrowser();
    gstPerfLog("gst.pdf.chromiumBrowser", launchStartedAtMs, { gstDocumentId });

    const renderStartedAtMs = gstPerfNow();
    page = await browser.newPage();
    // Data-URI logos mean "load" fires without waiting on the network.
    await page.setContent(html, { waitUntil: "load", timeout: 15000 });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true, // honor the stylesheet's @page { size: A4; margin: 10mm }
    });
    gstPerfLog("gst.pdf.chromiumRender", renderStartedAtMs, { gstDocumentId });

    const buffer = Buffer.from(pdf);
    gstPerfLog("gst.pdf.chromiumTotal", startedAtMs, { gstDocumentId, bytes: buffer.length });
    return { ok: true, data: { documentNumber, buffer } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Chromium PDF render failed",
    };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
