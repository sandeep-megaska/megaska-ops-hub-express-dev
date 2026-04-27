import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstTemplatesPage() {
  return (
    <GstShell title="GST Templates" subtitle="Invoice/CN/DN template customization module.">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 shadow-sm">
        Templates rebuild is intentionally deferred until GST Milestone 1 and 2 are verified.
      </div>
    </GstShell>
  )
}
