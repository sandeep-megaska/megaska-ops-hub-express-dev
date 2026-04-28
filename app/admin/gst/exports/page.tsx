import { GstReportsAdmin } from '../../../../components/gst/gst-reports-admin'
import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstExportPage() {
  return (
    <GstShell title="GST Reports" subtitle="Monthly B2C, Credit Note, and Debit Note exports.">
      <GstReportsAdmin />
    </GstShell>
  )
}
