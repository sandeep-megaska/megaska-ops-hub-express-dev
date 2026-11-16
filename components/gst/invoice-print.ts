// Print a GST invoice straight from the embedded admin (e.g. the order page's
// More actions → GST Invoice), instead of downloading the PDF and printing that.
//
// It prints the invoice's HTML view, not the generated PDF: the HTML lays itself
// out for the paper picked in the print dialog (A4 or A5), whereas the PDF is a
// fixed sheet that gets clipped when printed on smaller paper at actual size.
//
// `margins=printer` leaves the page margins to the printer: a fixed CSS margin
// let an Epson inkjet cut the top and sides off, though Save as PDF was fine.
//
// The HTML is fetched with the App Bridge session token, so no signed URL is
// needed, and written into a tab opened synchronously in the click handler (a
// tab opened after an await is blocked as a pop-up).

// Pure: makes the invoice HTML open the print dialog once it (and its logos)
// has loaded, and resolves relative URLs against the app's origin.
export function withAutoPrint(html: string, origin: string): string {
  const base = `<base href="${origin.replace(/"/g, '&quot;').replace(/\/+$/, '')}/" />`
  const script =
    '<script>window.addEventListener("load",function(){setTimeout(function(){window.focus();window.print();},300);});</script>'
  const withBase = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${base}`) : `${base}${html}`
  return /<\/body>/i.test(withBase) ? withBase.replace(/<\/body>/i, `${script}</body>`) : `${withBase}${script}`
}

export async function printGstInvoice(invoiceId: string, authHeaders: () => Promise<Record<string, string>>): Promise<void> {
  const tab = window.open('', '_blank')
  if (!tab) {
    throw new Error('Your browser blocked the print window. Allow pop-ups for this site, then click Print again.')
  }
  tab.document.write('<!doctype html><title>Preparing invoice…</title><p style="font-family:Arial,sans-serif;padding:24px">Preparing the invoice for printing…</p>')

  try {
    const response = await fetch(`/api/gst/invoices/${encodeURIComponent(invoiceId)}/pdf?format=html&margins=printer`, {
      credentials: 'include',
      cache: 'no-store',
      headers: await authHeaders(),
    })
    const contentType = response.headers.get('content-type') || ''
    if (!response.ok || !contentType.toLowerCase().includes('text/html')) {
      const json = await response.json().catch(() => null)
      throw new Error(json?.error || 'Unable to prepare the invoice for printing')
    }
    const html = await response.text()
    tab.document.open()
    tab.document.write(withAutoPrint(html, window.location.origin))
    tab.document.close()
  } catch (error) {
    tab.close()
    throw error
  }
}
