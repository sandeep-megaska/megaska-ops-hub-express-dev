'use client'

type RequestResult<T> = {
  ok: boolean
  data?: T
  error?: string
}

const SHOPIFY_ADMIN_HOST = 'admin.shopify.com'

function isBrowser(): boolean {
  return typeof window !== 'undefined'
}

function getApiBase(): string {
  if (!isBrowser()) return ''

  const hostname = window.location.hostname
  if (hostname === SHOPIFY_ADMIN_HOST) return '__GST_APP_ORIGIN_REQUIRED__'

  const envBase = process.env.NEXT_PUBLIC_APP_URL || ''
  return envBase.trim().replace(/\/$/, '')
}

async function request<T>(path: string, init?: RequestInit): Promise<RequestResult<T>> {
  const apiBase = getApiBase()

  if (apiBase === '__GST_APP_ORIGIN_REQUIRED__') {
    return {
      ok: false,
      error: 'GST runtime config error: NEXT_PUBLIC_APP_URL is required for embedded admin.shopify.com context.',
    }
  }

  const url = `${apiBase}${path}`

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

export const listSkuTaxMappings = (query: { search?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.search) search.set('search', query.search)
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

export const listDispatchReadyOrders = (query: { from?: string; to?: string } = {}) => {
  const search = new URLSearchParams()
  if (query.from) search.set('from', query.from)
  if (query.to) search.set('to', query.to)
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
  const res = await request<Record<string, unknown> & { run?: GstReportRun }>('/api/gst/reports/runs', {
    method: 'POST',
    body: JSON.stringify({
      reportType: 'B2C_SALES_REGISTER',
      format: 'CSV',
      periodStart: `${from}T00:00:00.000Z`,
      periodEnd: `${to}T23:59:59.999Z`,
    }),
  })

  if (!res.ok) return res
  return { ok: true, data: (res.data as { run?: GstReportRun })?.run || null } as const
}

export const downloadReportRunFile = (id: string) =>
  request<{ fileUrl?: string | null; csv?: string }>(`/api/gst/reports/runs/${encodeURIComponent(id)}/download`)
