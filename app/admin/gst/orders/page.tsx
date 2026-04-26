import { GstOrdersAdmin } from '../../../../components/gst/gst-orders-admin'
import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstOrdersPage() {
  return (
    <GstShell title="GST Orders" subtitle="Show recent Shopify orders, filter by date range, generate GST invoices, and print documents.">
      <GstOrdersAdmin />
    </GstShell>
  )
}
