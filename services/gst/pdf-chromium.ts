import type { Browser, Page } from "puppeteer-core";
import { renderGstPdf } from "./pdf";
import type { GstServiceResult } from "./types";
import { gstPerfLog, gstPerfNow } from "./perf";

// Headless-Chromium PDF renderer. Pipes the SAME HTML that renderGstPdf() already
// produces (and that the browser-side "Print" popup renders correctly on screen)
// through Chromium's real layout engine, emitting a true .pdf. Chromium runs the
// real CSS engine, so the A4-portrait right-margin truncation the hand-drawn
// pdf-binary.ts suffers from does not happen.
//
// Packaging notes (learned the hard way):
//   - puppeteer-core and @sparticuz/chromium MUST be listed in next.config.ts
//     serverExternalPackages, or Next's bundler tries to bundle Chromium into the
//     serverless output and breaks the whole route bundle.
//   - Everything here is imported LAZILY (dynamic import inside the render fn, and
//     the static imports above are type-only). Nothing puppeteer-related loads at
//     module-eval time, so simply importing this file into a route can never affect
//     that route's other code paths — only an actual render call pays for Chromium.

// A Chromium launch costs ~1-3s cold. One serverless instance serves many sequential
// requests, so keep ONE browser per warm instance and pay the launch once; a page is
// opened and closed per render while the browser persists.
let browserPromise: Promise<Browser> | null = null;

async function resolveLaunchOptions(): Promise<{ executablePath: string; args: string[]; headless: boolean }> {
  // Local/dev override: point at any Chrome/Chromium on the box (e.g. the sandbox's
  // /opt/pw-browsers/chromium). @sparticuz/chromium's bundled binary is Linux-x64
  // only, so an explicit path is how you test off-Lambda.
  const override = String(process.env.GST_PDF_CHROMIUM_EXECUTABLE_PATH || "").trim();
  if (override) {
    return {
      executablePath: override,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--font-render-hinting=none"],
      headless: true,
    };
  }

  // Serverless (Vercel/Lambda): @sparticuz/chromium ships a size-optimized Chromium
  // and the exact flags it needs.
  const { default: chromium } = await import("@sparticuz/chromium");
  return { executablePath: await chromium.executablePath(), args: chromium.args, headless: true };
}

async function getBrowser(): Promise<Browser> {
  const existing = browserPromise;
  if (existing) {
    const browser = await existing;
    if (browser.connected) return browser;
    browserPromise = null; // previous instance disconnected — relaunch below
  }

  const launch = (async () => {
    const { default: puppeteer } = await import("puppeteer-core");
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
    browserPromise = null; // don't cache a failed launch — next call retries clean
    throw error;
  }
}

export async function renderGstPdfBinary(
  gstDocumentId: string,
): Promise<GstServiceResult<{ documentNumber: string; buffer: Buffer }>> {
  const startedAtMs = gstPerfNow();

  // Reuse the existing HTML renderer verbatim — no template divergence. Logos are
  // already resolved to data URIs (#785), so the page needs no network at all.
  const htmlResult = await renderGstPdf(gstDocumentId);
  if (!htmlResult.ok || !htmlResult.data) {
    return { ok: false, error: htmlResult.error || "GST document not found" };
  }

  const { html, documentNumber } = htmlResult.data;

  let page: Page | null = null;
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
    return { ok: false, error: error instanceof Error ? error.message : "Chromium PDF render failed" };
  } finally {
    if (page) {
      await page.close().catch(() => {});
    }
  }
}
