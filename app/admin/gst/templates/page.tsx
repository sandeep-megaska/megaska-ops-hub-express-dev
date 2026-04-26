import { GstTemplatesAdmin } from '../../../../components/gst/gst-templates-admin'
import { GstShell } from '../../../../components/gst/gst-shell'

export default function GstTemplatesPage() {
  return (
    <GstShell title="GST Templates" subtitle="Customize invoice, credit note, and debit note template payloads.">
      <GstTemplatesAdmin />
    </GstShell>
  )
}
