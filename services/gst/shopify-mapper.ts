import type { GstInvoiceDraftInput, GstNoteDraftInput } from './types'

interface ShopifyLineLike {
  title?: string
  quantity?: number
  price?: string | number
  sku?: string
  tax_lines?: Array<{ rate?: number }>
}

interface ShopifyOrderLike {
  id?: string | number
  name?: string
  billing_address?: { province_code?: string; province?: string }
  shipping_address?: { province_code?: string; province?: string }
  customer?: { first_name?: string; last_name?: string }
  line_items?: ShopifyLineLike[]
}

export function mapShopifyOrderToInvoiceDraft(order: ShopifyOrderLike): GstInvoiceDraftInput {
  const lines = Array.isArray(order.line_items) ? order.line_items : []
  return {
    shopifyOrderId: order.id ? String(order.id) : undefined,
    shopifyOrderName: order.name ? String(order.name) : undefined,
    sourceOrderId: order.id ? String(order.id) : undefined,
    sourceOrderNumber: order.name ? String(order.name) : undefined,
    billingStateCode: order.billing_address?.province_code || order.billing_address?.province || undefined,
    shippingStateCode: order.shipping_address?.province_code || order.shipping_address?.province || undefined,
    buyer: {
      legalName: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Shopify Customer',
    },
    lines: lines.map((line) => ({
      description: String(line.title || 'Shopify line'),
      quantity: Number(line.quantity || 1),
      unitPrice: Number(line.price || 0),
      taxRate: Number((line.tax_lines?.[0]?.rate || 0) * 100),
      hsnOrSac: line.sku,
      unit: 'PCS',
      discount: 0,
    })),
    metadata: {
      integration: 'shopify',
      mode: 'future_hook_only',
    },
  }
}

export function mapShopifyRefundToCreditNoteDraft(order: ShopifyOrderLike): GstNoteDraftInput {
  return {
    ...mapShopifyOrderToInvoiceDraft(order),
    noteType: 'CREDIT_NOTE',
    sourceReference: 'SHOPIFY_REFUND',
  }
}
