import { Suspense } from 'react'
import { GstShell } from '../../../../../components/gst/gst-shell'
import { GstOrderInvoice } from '../../../../../components/gst/gst-order-invoice'

// Landing page for the "GST Invoice" admin *link* extension on the order page.
// Rendered inside the embedded admin app (full App Bridge context), so it uses
// the normal session-token auth and has no sandboxed-iframe limits.
export const dynamic = 'force-dynamic'

export default function GstOrderInvoicePage() {
  return (
    <GstShell title="GST Invoice" subtitle="Download or email the GST invoice for this order.">
      <Suspense fallback={<p>Loading GST invoice…</p>}>
        <GstOrderInvoice />
      </Suspense>
    </GstShell>
  )
}
