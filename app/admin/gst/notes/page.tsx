import { GstNotesAdmin } from '../../../../components/gst/gst-notes-admin'
import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstNotesPage() {
  return (
    <GstShell title="GST Credit / Debit Notes" subtitle="Issue GST-compliant credit and debit notes against tax invoices.">
      <GstNotesAdmin />
    </GstShell>
  )
}
