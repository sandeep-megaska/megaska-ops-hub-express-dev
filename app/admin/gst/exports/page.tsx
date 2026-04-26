import { GstExportRunner } from '../../../../components/gst/gst-export-runner'
import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstExportPage() {
  return (
    <GstShell title="GST Reports" subtitle="Monthly B2C / Credit Note / Debit Note exports.">
      <GstExportRunner />
    </GstShell>
  )
}
