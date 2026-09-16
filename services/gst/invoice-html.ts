import type { GstInvoiceRenderModel } from "./pdf";
import type { GstInvoicePaperSize } from "./template";

// Pure invoice-HTML rendering: no database, no filesystem, no Shopify. Split out of
// pdf.ts so the print layout can be rendered and measured from a plain model, which is
// what services/gst/invoice-print-layout.test.mts does.

function escapeHtml(value: string): string {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export interface GstInvoicePaperGeometry {
  /** Value for the CSS `@page { size: ... }` descriptor. */
  cssPageSize: string;
  cssPageMargin: string;
  /** Width of the simulated sheet in the on-screen preview, CSS px at ~96dpi. */
  screenWidthPx: number;
  /** Concrete sheet a server-side renderer must use when the CSS size is `auto`. */
  pdfFormat: "A4" | "A5";
}

export const GST_INVOICE_PAPER_GEOMETRY: Record<GstInvoicePaperSize, GstInvoicePaperGeometry> = {
  auto: { cssPageSize: "auto", cssPageMargin: "10mm", screenWidthPx: 794, pdfFormat: "A4" },
  A4: { cssPageSize: "A4 portrait", cssPageMargin: "10mm", screenWidthPx: 794, pdfFormat: "A4" },
  A5: { cssPageSize: "A5 portrait", cssPageMargin: "8mm", screenWidthPx: 559, pdfFormat: "A5" },
};

// Pure HTML builder: no database, no I/O. Kept separate from renderGstPdf so the
// print layout can be exercised (and its page box measured) without a GST document.
export function buildGstInvoiceHtml(model: GstInvoiceRenderModel, paperSize: GstInvoicePaperSize): string {
  const cfg = model.templateConfig;
  const paper = GST_INVOICE_PAPER_GEOMETRY[paperSize];
  // De-cramped portrait rows: a wide Item Description that wraps, with SKU / HSN /
  // variant / per-line tax breakup on a compact sub-line, and only Qty / Taxable / GST% /
  // Total as aligned numeric columns.
  const lineMeta = (line: GstInvoiceRenderModel["rows"][number]) => {
    const parts: string[] = [];
    if (cfg.showSku && line.sku) parts.push(`SKU: ${line.sku}`);
    if (cfg.showHsn && line.hsn) parts.push(`HSN: ${line.hsn}`);
    if (cfg.showVariant && line.variant) parts.push(`Variant: ${line.variant}`);
    if (cfg.showTaxBreakup) parts.push(`CGST: ${line.cgst}`, `SGST: ${line.sgst}`, `IGST: ${line.igst}`);
    return parts.join(" · ");
  };
  const rows = model.rows
    .map((line) => {
      const meta = lineMeta(line);
      return `<tr>` +
        `<td>${escapeHtml(line.lineNumber)}</td>` +
        `<td><div class="item-desc">${escapeHtml(line.description)}</div>${meta ? `<div class="item-meta">${escapeHtml(meta)}</div>` : ""}</td>` +
        `<td class="num">${escapeHtml(line.quantity)}</td>` +
        `<td class="num">${escapeHtml(line.taxable)}</td>` +
        `<td class="num">${escapeHtml(line.gstRate)}%</td>` +
        `<td class="num">${escapeHtml(line.total)}</td>` +
        `</tr>`;
    })
    .join("\n");

  const renderParty = (title: string, party: { name: string; gstin?: string; phone?: string; email?: string; lines: string[] }) => `
    <div class="block"><strong>${escapeHtml(title)}</strong>
      <div>${escapeHtml(party.name)}</div>
      ${party.gstin ? `<div>GSTIN: ${escapeHtml(party.gstin || "UNREGISTERED")}</div>` : ""}
      ${party.phone ? `<div>Phone: ${escapeHtml(party.phone)}</div>` : ""}
      ${party.email ? `<div>Email: ${escapeHtml(party.email)}</div>` : ""}
      ${party.lines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}
    </div>`;

  const html = `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(model.documentNumber)}</title>
    <style>
      /* The sheet the layout targets. A hard-coded A4 page box is what clipped A5
         prints: the box stayed A4 while the physical sheet was smaller, and browsers
         do not scale to fit unless the operator changes Scale by hand. "auto" adopts
         whatever paper the print dialog selects; an explicit size pins the box, which
         is what the server-side PDF renderers need. */
      @page { size: ${paper.cssPageSize}; margin: ${paper.cssPageMargin}; }
      body { font-family: Arial, sans-serif; color:#111; font-size:9px; margin:0; }
      .topline { display:flex; justify-content:space-between; gap:8px; border-bottom:1px solid #111; padding-bottom:8px; margin-bottom:10px; }
      .meta { text-align:right; }
      .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin: 10px 0; }
      .block { border:1px solid #ddd; padding:8px; min-height:90px; }
      /* A long email or address must wrap inside its column rather than widen the
         page box past the sheet. */
      .block div, .topline div { overflow-wrap:anywhere; }
      .header-logo{ display:flex; justify-content:center; align-items:center; margin-bottom:8px; min-height:34px; font-size:16px; font-weight:700; letter-spacing:1px; text-transform:lowercase; }
      .header-logo img{ max-height:32px; max-width:220px; object-fit:contain; }
      /* Line items: a wide Item Description that wraps, with SKU/HSN/tax breakup on a
         sub-line, instead of squeezing every field into a narrow portrait column. */
      table{ border-collapse:collapse; width:100%; table-layout:fixed; } th,td{ border:1px solid #ddd; padding:4px; vertical-align:top; font-size:8px; } th{ background:#f6f6f6; font-size:7.5px; }
      td{ word-break:break-word; }
      td.num, th.num{ text-align:right; white-space:nowrap; }
      .item-desc{ font-weight:600; }
      .item-meta{ margin-top:2px; color:#555; font-size:7px; }
      /* Sized in mm, not px: a fixed px width is exactly what overflows a narrower sheet. */
      .totals{ width:100%; max-width:72mm; margin-left:auto; margin-top:10px; } .totals td{ border:0; padding:3px 0; }
      .footer-logo{ margin-top:8px; display:flex; justify-content:flex-end; min-height:22px; font-size:12px; font-weight:700; }
      .footer-logo img{ max-height:20px; max-width:140px; object-fit:contain; }
      .print-btn{ margin-bottom:8px; }
      .page{ background:#fff; }
      /* On screen, simulate the selected sheet so the preview matches the print. */
      @media screen {
        body{ background:#e9e9ee; padding:16px; }
        .page{ max-width:${paper.screenWidthPx}px; margin:0 auto; padding:28px 32px; box-shadow:0 1px 6px rgba(0,0,0,0.18); }
      }
      @media print {
        .print-btn { display:none; }
        .page{ max-width:none; margin:0; padding:0; box-shadow:none; }
        /* A long invoice must paginate, not run off the bottom of the sheet: the header
           row repeats on each page and no row, total or sign-off is split across a break. */
        table{ page-break-inside:auto; }
        thead{ display:table-header-group; }
        tr{ break-inside:avoid; page-break-inside:avoid; }
        .totals, .sign-off, .footer-logo{ break-inside:avoid; page-break-inside:avoid; }
      }
      /* Any sheet narrower than A5 plus slack — pinned above or chosen in the print
         dialog — gets the compact scale so the same content fits its page box. */
      @media print and (max-width: 160mm) {
        body{ font-size:8px; }
        .topline{ padding-bottom:6px; margin-bottom:8px; }
        .grid{ grid-template-columns:1fr 1fr; gap:6px; margin:8px 0; }
        .block{ min-height:0; padding:6px; }
        th,td{ padding:3px; font-size:7px; }
        th{ font-size:6.5px; }
        .item-meta{ font-size:6px; }
        .totals{ max-width:58mm; }
        .header-logo{ min-height:26px; font-size:13px; margin-bottom:6px; }
        .header-logo img{ max-height:24px; max-width:150px; }
        .footer-logo{ min-height:18px; font-size:10px; }
        .footer-logo img{ max-height:16px; max-width:110px; }
      }
    </style></head><body><div class="page">
    <button class="print-btn" onclick="window.print()">Print ${escapeHtml(model.title)}</button>
    ${model.templateConfig.showHeaderLogo ? `<div class="header-logo">${model.branding.headerLogoSrc ? `<img src="${escapeHtml(model.branding.headerLogoSrc)}" alt="Header logo" />` : "bigonbuy"}</div>` : ""}
    <div class="topline"><div><div><strong>GSTIN: ${escapeHtml(model.supplier.gstin)}</strong></div><div>${escapeHtml(model.title)}</div><div>Original for Recipient</div></div>
    <div class="meta"><div><strong>${escapeHtml(model.supplier.tradeName || model.supplier.name)}</strong></div><div>${escapeHtml(model.supplier.name)}</div></div></div>
    <div class="topline"><div>Invoice No: ${escapeHtml(model.documentNumber)}<br/>Invoice Date: ${escapeHtml(model.documentDate)}<br/>Order: ${escapeHtml(model.orderNumber)}</div><div class="meta">Place of Supply: ${escapeHtml(model.placeOfSupply)}<br/>Order Date: ${escapeHtml(model.orderDate)}</div></div>
    <div class="grid">
      ${renderParty("BILLED TO", model.buyer)}
      ${renderParty("SHIP TO", model.shipping)}
      ${renderParty("SUPPLIER", model.supplier)}
    </div>
    <table>
      <colgroup><col style="width:5%"><col style="width:43%"><col style="width:8%"><col style="width:16%"><col style="width:8%"><col style="width:20%"></colgroup>
      <thead><tr><th>#</th><th>Item Description</th><th class="num">Qty</th><th class="num">Taxable</th><th class="num">GST%</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <table class="totals"><tr><td>Taxable</td><td>${model.totals.taxable}</td></tr>${model.templateConfig.showTaxBreakup ? `<tr><td>CGST</td><td>${model.totals.cgst}</td></tr><tr><td>SGST</td><td>${model.totals.sgst}</td></tr><tr><td>IGST</td><td>${model.totals.igst}</td></tr><tr><td>CESS</td><td>${model.totals.cess}</td></tr>` : ""}<tr><td><strong>Total</strong></td><td><strong>${model.totals.total}</strong></td></tr></table>
    ${model.templateConfig.showAmountInWords ? `<p><strong>Amount in Words:</strong> ${escapeHtml(model.amountInWords)}</p>` : ""}
    ${model.templateConfig.showDeclaration && model.declaration ? `<p><strong>Declaration:</strong> ${escapeHtml(model.declaration)}</p>` : ""}
    ${model.templateConfig.showFooterNote ? `<p>${escapeHtml(model.footer)}</p>` : ""}
    ${model.templateConfig.showFooterLogo ? `<div class="footer-logo">${model.branding.footerLogoSrc ? `<img src="${escapeHtml(model.branding.footerLogoSrc)}" alt="Footer logo" />` : escapeHtml(model.supplier.tradeName || model.supplier.name)}</div>` : ""}
    ${model.signature ? `<p class="sign-off" style="text-align:right; margin-top:18px;">For ${escapeHtml(model.supplier.name)}<br/><br/>${escapeHtml(model.signature)}</p>` : ""}
  </div></body></html>`;

  return html;
}
