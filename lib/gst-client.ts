'use client'

type RequestResult<T> = {
  ok: boolean
  data?: T
  error?: string
}

// Every GST admin API route identifies the shop from the request. Historically
// that relied solely on the Referer header carrying ?shop=..., which silently
// breaks whenever the referrer is stripped or a page is opened without the
// query string - the request then falls back to shopId: null, so mappings and
// settings save under the wrong scope and "don't persist". Read the shop from
// the current URL (GstShell keeps ?shop=... on every nav link) and send it
// explicitly, matching how the reviews/refunds/exchanges admin clients work.
// The server reads this query param before the Referer, so resolution becomes
// deterministic instead of referrer-dependent.
function withShopParam(path: string): string {
  if (typeof window === 'undefined') return path

  let shop = ''
  try {
    const current = new URLSearchParams(window.location.search)
    shop = current.get('shop') || current.get('shopify_shop') || ''
  } catch {
    shop = ''
  }
  if (!shop) return path

  const queryIndex = path.indexOf('?')
  const pathname = queryIndex === -1 ? path : path.slice(0, queryIndex)
  const search = new URLSearchParams(queryIndex === -1 ? '' : path.slice(queryIndex + 1))
  if (!search.get('shop')) search.set('shop', shop)
  const qs = search.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

async function request<T>(path: string, init?: RequestInit): Promise<RequestResult<T>> {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const url = withShopParam(normalized)

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
      ...init,
    })

    const data = (await res.json().catch(() => ({}))) as RequestResult<T>
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        error: data.error || `Request failed with status ${res.status}`,
      }
    }

    return {
      ok: true,
      data: data.data,
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Network request failed',
    }
  }
}

export const getGstSettings = async () => {
  const res = await request<Record<string, unknown> & { settings?: Record<string, unknown> }>('/api/gst/settings')
  if (!res.ok) return res
  return { ok: true, data: (res.data as { settings?: Record<string, unknown> })?.settings || {} } as const
}

export const createOrUpdateGstSettings = async (payload: Record<string, unknown>) => {
  const res = await request<Record<string, unknown> & { settings?: Record<string, unknown> }>('/api/gst/settings', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) return res
  return { ok: true, data: (res.data as { settings?: Record<string, unknown> })?.settings || {} } as const
}

export const getDefaultGstTemplate = async () => {
  const res = await request<Record<string, unknown> & { template?: Record<string, unknown> | null }>('/api/gst/templates/default')
  if (!res.ok) return res
  return { ok: true, data: (res.data as { template?: Record<string, unknown> | null })?.template || null } as const
}

export const saveDefaultGstTemplate = async (payload: Record<string, unknown>) => {
  const res = await request<Record<string, unknown> & { template?: Record<string, unknown> }>('/api/gst/templates/default', {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  if (!res.ok) return res
  return { ok: true, data: (res.data as { template?: Record<string, unknown> })?.template || {} } as const
}

export const listSkuTaxMappings = (query: { search?: string; view?: 'all' | 'unmapped' } = {}) => {
  const search = new URLSearchParams()
  if (query.search) search.set('search', query.search)
  if (query.view === 'unmapped') search.set('view', 'unmapped')
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<Array<Record<string, unknown>>>(`/api/gst/products/sku-mappings${suffix}`)
}

export const upsertSkuTaxMapping = (payload: Record<string, unknown>) =>
  request<Record<string, unknown>>('/api/gst/products/sku-mappings', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const importSkuMappingsCsv = (payload: { csvText: string }) =>
  request<Record<string, unknown>>('/api/gst/products/sku-mappings/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const syncOrders = (payload: Record<string, unknown>) =>
  request<Record<string, unknown>>('/api/gst/orders/sync', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const getB2cInvoiceAvailability = ({ from, to }: { from: string; to: string }) => {
  const search = new URLSearchParams()
  search.set('from', from)
  search.set('to', to)
  return request<{ invoiceCount?: number }>(`/api/gst/reports/b2c/availability?${search.toString()}`)
}

export const listDispatchReadyOrders = (query: { from?: string; to?: string; invoiceStatus?: string; readiness?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
  if (query.invoiceStatus) search.set('invoiceStatus', query.invoiceStatus)
  if (query.readiness) search.set('readiness', query.readiness)
  const suffix = search.toString() ? `?${search.toString()}` : ''
  return request<Array<Record<string, unknown>>>(`/api/gst/orders/dispatch-ready${suffix}`)
}

export const generateBatchInvoices = (payload: Record<string, unknown>) =>
  request<Record<string, unknown>>('/api/gst/invoices/generate-batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

export const preparePrintBatch = (payload: Record<string, unknown>) =>
  request<Record<string, unknown>>('/api/gst/invoices/print-batch', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

type GstReportRun = {
  id: string
  fileUrl?: string | null
  warnings?: Array<Record<string, unknown>>
}

export const generateB2cSalesRegisterRun = async ({ from, to }: { from: string; to: string }) => {
  const res = await fetch(withShopParam('/api/gst/reports/runs'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reportType: 'B2C_SALES_REGISTER',
      format: 'CSV',
      periodStart: `${from}T00:00:00.000Z`,
      periodEnd: `${to}T23:59:59.999Z`,
    }),
  })

  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    run?: GstReportRun
    csv?: string
    warnings?: Array<Record<string, unknown>>
    headers?: string[]
    rowCount?: number
    reportType?: string
  }

  if (!res.ok || !payload.ok) {
    return { ok: false, error: payload.error || `Request failed with status ${res.status}` } as const
  }

  return { ok: true, data: payload } as const
}

export const downloadReportRunFile = (id: string) =>
  request<{ fileUrl?: string | null; csv?: string }>(`/api/gst/reports/runs/${encodeURIComponent(id)}/download`)

export type GstDocumentListItem = {
  id: string
  documentType: string
  documentNumber: string
  status: string
  documentDate: string
  sourceOrderNumber?: string | null
  totalAmount?: unknown
}

export async function listGstDocuments(params: { documentType?: string; limit?: number; search?: string }) {
  const search = new URLSearchParams()
  if (params.documentType) search.set('documentType', params.documentType)
  if (params.limit) search.set('limit', String(params.limit))
  if (params.search) search.set('search', params.search)
  const qs = search.toString()
  const res = await fetch(withShopParam(`/api/gst/documents${qs ? `?${qs}` : ''}`), {
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  })
  const payload = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    documents?: GstDocumentListItem[]
  }
  if (!res.ok || !payload.ok) {
    return { ok: false as const, error: payload.error || `Request failed with status ${res.status}` }
  }
  return { ok: true as const, data: payload.documents || [] }
}

export async function createGstNote(payload: {
  noteType: 'CREDIT_NOTE' | 'DEBIT_NOTE'
  originalDocumentId: string
  reason?: string
  sourceOrderNumber?: string
}) {
  const res = await fetch(withShopParam('/api/gst/notes/draft'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      noteType: payload.noteType,
      originalDocumentId: payload.originalDocumentId,
      sourceOrderNumber: payload.sourceOrderNumber,
      metadata: payload.reason ? { reason: payload.reason } : {},
    }),
  })
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean
    error?: string
    note?: { id: string; documentNumber: string; documentType: string }
  }
  if (!res.ok || !data.ok) {
    return { ok: false as const, error: data.error || `Request failed with status ${res.status}` }
  }
  return { ok: true as const, data: data.note }
}

export function gstDocumentViewUrl(id: string, format: 'html' | 'pdf' = 'html'): string {
  return withShopParam(`/api/gst/documents/${encodeURIComponent(id)}/pdf?format=${format}`)
}
