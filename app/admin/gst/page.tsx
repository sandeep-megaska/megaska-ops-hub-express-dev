import { GstOrdersAdmin } from '../../../components/gst/gst-orders-admin'
import { GstShell } from '../../../components/gst/gst-shell'

export default function GstPage() {
  return (
    <GstShell
      title="GST Operations"
      subtitle="Sync Shopify orders, review GST warnings, generate shipment invoices, print branded invoice copies, and export CA-ready registers."
    >
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Step 1</div>
          <h2 className="mt-1 text-base font-semibold text-gray-900">Sync Shopify orders</h2>
          <p className="mt-2 text-sm text-gray-600">Choose a period, pull orders into the GST import queue, and review warnings without blocking invoicing.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Step 2</div>
          <h2 className="mt-1 text-base font-semibold text-gray-900">Generate shipment invoices</h2>
          <p className="mt-2 text-sm text-gray-600">Select orders and create GST invoices using SKU/style GST mappings and the tax engine.</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Step 3</div>
          <h2 className="mt-1 text-base font-semibold text-gray-900">Print & export for CA</h2>
          <p className="mt-2 text-sm text-gray-600">Open printable invoice copies for shipments and export B2C / CN / DN CSV files from the Exports tab.</p>
        </div>
      </div>

      <GstOrdersAdmin />
    </GstShell>
  )
}
