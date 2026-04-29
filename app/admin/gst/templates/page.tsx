import { GstShell } from '../../../../components/gst/gst-shell'
import { GstTemplateAdmin } from '../../../../components/gst/gst-template-admin'

export default function GstTemplatesPage() {
  return (
    <GstShell title="GST Templates" subtitle="Invoice/CN/DN template customization module.">
      <GstTemplateAdmin />
    </GstShell>
  )
}
