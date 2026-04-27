import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstExportPage() {
  return (
    <GstShell title="GST Reports" subtitle="Monthly B2C, Credit Note, and Debit Note exports.">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-700 shadow-sm">
        Reports rebuild is intentionally deferred until GST Milestone 1 and 2 are verified.
      </div>
    </GstShell>
  )
}
