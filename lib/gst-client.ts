export type ApiResult<T> = {
  ok: boolean
  status: number
  data?: T
  error?: string
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || '').trim().replace(/\/$/, '')
const SHOPIFY_ADMIN_HOST = 'admin.shopify.com'

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '[::1]'
}

function resolveApiBase(): string {
  if (APP_URL) return APP_URL

  if (typeof window === 'undefined') return ''

  const { hostname, origin } = window.location
  if (hostname === SHOPIFY_ADMIN_HOST || isLocalhost(hostname)) return ''

  return origin
}

async function request<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  const apiBase = resolveApiBase()
  const resolvedUrl = `${apiBase}${url}`

  if (process.env.NODE_ENV !== 'production') {
    console.debug('[GST CLIENT] api request', { url, resolvedUrl })
  }

  try {
    const res = await fetch(resolvedUrl, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      cache: 'no-store',
    })

    const contentType = res.headers.get('content-type') || ''
    const body = contentType.includes('application/json') ? await res.json() : await res.text()

    if (!res.ok) {
      return { ok: false, status: res.status, error: typeof body === 'string' ? body : body?.error || 'Request failed' }
    }

    return { ok: true, status: res.status, data: body as T }
  } catch (error) {
    return { ok: false, status: 500, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

export const getGstSettings = () => request<{ ok: boolean; settings: Record<string, unknown> }>('/api/gst/settings')
export const createOrUpdateGstSettings = (payload: Record<string, unknown>) => request<{ ok: boolean; settings: Record<string, unknown> }>('/api/gst/settings', { method: 'POST', body: JSON.stringify(payload) })

export const createInvoiceDraft = (payload: Record<string, unknown>) => request<{ ok: boolean; invoice: Record<string, unknown> }>('/api/gst/invoices/draft', { method: 'POST', body: JSON.stringify(payload) })
export const getInvoiceById = (id: string) => request<{ ok: boolean; invoice: Record<string, unknown> }>(`/api/gst/invoices/${id}`)

export const createNoteDraft = (payload: Record<string, unknown>) => request<{ ok: boolean; note: Record<string, unknown> }>('/api/gst/notes/draft', { method: 'POST', body: JSON.stringify(payload) })
export const getNoteById = (id: string) => request<{ ok: boolean; note: Record<string, unknown> }>(`/api/gst/notes/${id}`)

export const invoicePreview = (payload: Record<string, unknown>) => request<{ ok: boolean; preview: Record<string, unknown> }>('/api/gst/debug/invoice-preview', { method: 'POST', body: JSON.stringify(payload) })
export const notePreview = (payload: Record<string, unknown>) => request<{ ok: boolean; preview: Record<string, unknown> }>('/api/gst/debug/note-preview', { method: 'POST', body: JSON.stringify(payload) })
export const reconcilePreview = (payload: Record<string, unknown>) => request<{ ok: boolean; comparison: Record<string, unknown> }>('/api/gst/debug/reconcile', { method: 'POST', body: JSON.stringify(payload) })

export const runReconciliation = (payload: Record<string, unknown>) => request<{ ok: boolean; reconciliation: Record<string, unknown> }>('/api/gst/reconciliation/runs', { method: 'POST', body: JSON.stringify(payload) })
export const listReconciliationRuns = () => request<{ ok: boolean; runs: Array<Record<string, unknown>> }>('/api/gst/reconciliation/runs')
export const createExport = (payload: Record<string, unknown>) => request<{ ok: boolean; export: Record<string, unknown> }>('/api/gst/exports', { method: 'POST', body: JSON.stringify(payload) })
export const listExports = () => request<{ ok: boolean; exports: Array<Record<string, unknown>> }>('/api/gst/exports')
export const listDocuments = (query: { documentType?: string; status?: string; search?: string } = {}) => {
  const params = new URLSearchParams()
  if (query.documentType) params.set('documentType', query.documentType)
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  const search = params.toString()
  return request<{ ok: boolean; documents: Array<Record<string, unknown>> }>(`/api/gst/documents${search ? `?${search}` : ''}`)
}
export const getDocumentById = (id: string) => request<{ ok: boolean; document: Record<string, unknown> }>(`/api/gst/documents/${id}`)
export const getPdfPayload = (id: string) => request<{ ok: boolean; pdf: Record<string, unknown> }>(`/api/gst/documents/${id}/pdf`)

export const createReportRun = (payload: Record<string, unknown>) => request<{ ok: boolean; run: Record<string, unknown> }>('/api/gst/reports/runs', { method: 'POST', body: JSON.stringify(payload) })
export const listReportRuns = (query: { reportType?: string; status?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.reportType) search.set('reportType', query.reportType)
  if (query.status) search.set('status', query.status)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; runs: Array<Record<string, unknown>> }>(`/api/gst/reports/runs${suffix}`)
}
export const downloadReportRunFile = (id: string) => request<{ ok: boolean; fileUrl: string | null }>(`/api/gst/reports/runs/${id}/download`)

export const listHsnCodes = () => request<{ ok: boolean; data: Array<Record<string, unknown>> }>('/api/gst/hsn')
export const upsertHsnCode = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown> }>('/api/gst/hsn', { method: 'POST', body: JSON.stringify(payload) })
export const deleteHsnCode = (id: string) => request<{ ok: boolean; data: Record<string, unknown> }>(`/api/gst/hsn?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

export const listTaxSlabs = () => request<{ ok: boolean; data: Array<Record<string, unknown>> }>('/api/gst/tax-slabs')
export const upsertTaxSlab = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown> }>('/api/gst/tax-slabs', { method: 'POST', body: JSON.stringify(payload) })
export const deleteTaxSlab = (id: string) => request<{ ok: boolean; data: Record<string, unknown> }>(`/api/gst/tax-slabs?id=${encodeURIComponent(id)}`, { method: 'DELETE' })

export const assignSlabToHsn = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown> }>('/api/gst/hsn', { method: 'POST', body: JSON.stringify(payload) })

export const listProductTaxMappings = (query: { status?: string; shopifyProductId?: string; shopifyVariantId?: string; search?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.status) search.set('status', query.status)
  if (query.shopifyProductId) search.set('shopifyProductId', query.shopifyProductId)
  if (query.shopifyVariantId) search.set('shopifyVariantId', query.shopifyVariantId)
  if (query.search) search.set('search', query.search)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; data: Array<Record<string, unknown>> }>(`/api/gst/products/mappings${suffix}`)
}
export const upsertProductTaxMapping = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown> }>('/api/gst/products/mappings', { method: 'POST', body: JSON.stringify(payload) })
export const listUnmappedProducts = (query: { search?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.search) search.set('search', query.search)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; data: Array<Record<string, unknown>> }>(`/api/gst/products/unmapped${suffix}`)
}
export const importSkuMappingsCsv = (payload: { csvText: string }) =>
  request<{ ok: boolean; imported: number; skipped: number; errors: string[]; recompute?: Record<string, unknown> }>(
    '/api/gst/products/sku-mappings/import',
    { method: 'POST', body: JSON.stringify(payload) },
  )
export const recomputeSkuMappingReadiness = () =>
  request<{ ok: boolean; data: Record<string, unknown> }>('/api/gst/products/sku-mappings/recompute', { method: 'POST' })

export const listImportedOrders = (query: { gstSettingsId?: string; importStatus?: string; eligibilityStatus?: string; from?: string; to?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.gstSettingsId) search.set('gstSettingsId', query.gstSettingsId)
  if (query.importStatus) search.set('importStatus', query.importStatus)
  if (query.eligibilityStatus) search.set('eligibilityStatus', query.eligibilityStatus)
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; data: Array<Record<string, unknown>> }>(`/api/gst/orders${suffix}`)
}
export const importOrder = (payload: Record<string, unknown>) => request<{ ok: boolean; order: Record<string, unknown> }>('/api/gst/orders/import', { method: 'POST', body: JSON.stringify(payload) })
export const getImportedOrderById = (id: string) => request<{ ok: boolean; data: Record<string, unknown> }>(`/api/gst/orders/${id}`)
export const syncOrders = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/orders/sync', { method: 'POST', body: JSON.stringify(payload) })
export const syncSingleOrder = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/orders/sync-single', { method: 'POST', body: JSON.stringify(payload) })
export const listDispatchReadyOrders = (query: { from?: string; to?: string; invoiceStatus?: string; readiness?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  if (query.invoiceStatus) search.set('invoiceStatus', query.invoiceStatus)
  if (query.readiness) search.set('readiness', query.readiness)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; data: Array<Record<string, unknown>>; error: string | null }>(`/api/gst/orders/dispatch-ready${suffix}`)
}
export const generateBatchInvoices = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/invoices/generate-batch', { method: 'POST', body: JSON.stringify(payload) })
export const preparePrintBatch = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/invoices/print-batch', { method: 'POST', body: JSON.stringify(payload) })
export const bulkPreviewProductMappings = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/products/mappings/bulk-preview', { method: 'POST', body: JSON.stringify(payload) })
export const bulkApplyProductMappings = (payload: Record<string, unknown>) => request<{ ok: boolean; data: Record<string, unknown>; error: string | null }>('/api/gst/products/mappings/bulk-apply', { method: 'POST', body: JSON.stringify(payload) })

export const listTemplates = (query: { gstSettingsId?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.gstSettingsId) search.set('gstSettingsId', query.gstSettingsId)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<{ ok: boolean; templates: Array<Record<string, unknown>> }>(`/api/gst/templates${suffix}`)
}
export const createTemplate = (payload: Record<string, unknown>) => request<{ ok: boolean; template: Record<string, unknown> }>('/api/gst/templates', { method: 'POST', body: JSON.stringify(payload) })
export const updateTemplate = (id: string, payload: Record<string, unknown>) => request<{ ok: boolean; template: Record<string, unknown> }>(`/api/gst/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) })
export const setDefaultTemplate = (id: string) => request<{ ok: boolean; updated: boolean }>(`/api/gst/templates/${id}/set-default`, { method: 'POST' })
export const previewTemplate = (id: string, payload: Record<string, unknown>) => request<{ ok: boolean; preview: Record<string, unknown> }>(`/api/gst/templates/${id}/preview`, { method: 'POST', body: JSON.stringify(payload) })
