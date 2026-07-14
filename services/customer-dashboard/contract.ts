export const CUSTOMER_DASHBOARD_CONTRACT_VERSION = "dashboard.v1" as const;

export type CustomerDashboardDtoV1 = {
  version: typeof CUSTOMER_DASHBOARD_CONTRACT_VERSION;
  generatedAt: string;
  shop: DashboardShopDto;
  customer: DashboardCustomerDto;
  summary: DashboardSummaryDto;
  wallet: DashboardWalletDto | null;
  addresses: DashboardAddressDto[];
  orders: DashboardOrderDto[];
  modules: DashboardModulesDto;
};

export type DashboardShopDto = {
  id: string;
  domain: string;
  name: string | null;
  currency: string;
  support: { email: string | null; phone: string | null; whatsapp: string | null; contactUrl: string | null };
  branding: { accountLabel: string; logoUrl: string | null };
};

export type DashboardCustomerDto = {
  id: string; firstName: string | null; lastName: string | null; displayName: string; initials: string; phone: string; phoneVerified: boolean; email: string | null; shopifyCustomerId: string | null;
};

export type DashboardSummaryDto = { totalOrders: number; openRequests: number; savedAddresses: number; storeCreditAvailablePaise: number; currency: string };

export type DashboardWalletDto = { enabled: boolean; currency: string; balancePaise: number; reservedPaise: number; availablePaise: number; pendingRefundPaise: number; transactions: DashboardWalletTransactionDto[] };
export type DashboardWalletTransactionDto = { id: string; direction: "CREDIT" | "DEBIT"; amountPaise: number; currency: string; reason: string; orderNumber: string | null; createdAt: string };

export type DashboardAddressDto = { id: string; type: "DEFAULT" | "OTHER"; firstName: string | null; lastName: string | null; company: string | null; line1: string; line2: string | null; city: string; state: string | null; postalCode: string; country: string; phone: string | null; isDefault: boolean; source: "SHOPIFY" | "LOOPDESK" };

export type DashboardStatusTone = "SUCCESS" | "WARNING" | "INFO" | "DANGER" | "NEUTRAL";
export type DashboardStatusDto = { code: string; label: string; tone: DashboardStatusTone };

export type DashboardOrderAmountsDto = { subtotalPaise: number | null; discountPaise: number; shippingPaise: number; taxPaise: number | null; codFeePaise: number; storeCreditAppliedPaise: number; totalPaise: number };
export type DashboardPaymentMethod = "PREPAID" | "COD" | "PARTIAL_COD" | "STORE_CREDIT" | "MIXED" | "UNKNOWN";
export type DashboardPaymentSummaryDto = { method: DashboardPaymentMethod; status: string; prepaidPaidPaise: number; codAdvancePaidPaise: number; codBalancePaise: number; storeCreditAppliedPaise: number; currency: string };
export type DashboardOrderItemDto = { id: string; productId: string | null; variantId: string | null; title: string; variantTitle: string | null; sku: string | null; quantity: number; unitPricePaise: number; totalPricePaise: number; imageUrl: string | null; productUrl: string | null };

export type DashboardTrackingSource = "LOOPDESK_SHIPMENT" | "SHOPIFY_FULFILLMENT" | "NONE";
export type DashboardShipmentDirection = "FORWARD" | "REVERSE_PICKUP" | "REPLACEMENT";
export type DashboardShipmentEventDto = { id: string; statusCode: string; statusLabel: string; occurredAt: string; description: string | null; location: string | null };
export type DashboardShipmentDto = { id: string; direction: DashboardShipmentDirection; carrier: string | null; awb: string | null; trackingUrl: string | null; statusCode: string; statusLabel: string; lastUpdatedAt: string | null; timeline: DashboardShipmentEventDto[] };
export type DashboardTrackingDto = { available: boolean; source: DashboardTrackingSource; summary: { statusCode: string; statusLabel: string; lastUpdatedAt: string | null; message: string | null }; shipments: DashboardShipmentDto[] };

export type DashboardOrderActionType = "CANCELLATION" | "EXCHANGE" | "ISSUE" | "REFUND_STATUS";
export type DashboardOrderActionState = "AVAILABLE" | "LOCKED" | "OPEN" | "IN_PROGRESS" | "COMPLETED" | "REJECTED" | "CANCELLED" | "NOT_APPLICABLE";
export type DashboardOrderActionDto = { type: DashboardOrderActionType; available: boolean; state: DashboardOrderActionState; label: string; description: string | null; lockReason: string | null; deadlineAt: string | null; requestId: string | null };
export type DashboardOrderActionsDto = { cancellation: DashboardOrderActionDto; exchange: DashboardOrderActionDto; issue: DashboardOrderActionDto; refundStatus: DashboardOrderActionDto };

export type DashboardRequestSummaryDto = { id: string; type: "CANCELLATION" | "ISSUE"; statusCode: string; statusLabel: string; requestedAt: string; updatedAt: string | null; customerMessage: string | null };
export type DashboardRequestPaymentDto = { status: string; amountPaise: number; currency: string; paidAt: string | null };
export type DashboardProgressStepDto = { key: string; label: string; state: "COMPLETED" | "PENDING" };
export type DashboardExchangeRequestDto = { id: string; statusCode: string; statusLabel: string; requestedAt: string; payment: DashboardRequestPaymentDto | null; reverseShipment: DashboardShipmentDto | null; replacementShipment: DashboardShipmentDto | null; progress: DashboardProgressStepDto[] };
export type DashboardOrderRequestsDto = { cancellation: DashboardRequestSummaryDto | null; exchange: DashboardExchangeRequestDto | null; issue: DashboardRequestSummaryDto | null };
export type DashboardOrderRequestTimelineRequestType = "CANCELLATION" | "EXCHANGE" | "ISSUE";
export type DashboardOrderRequestTimelineEventType = "REQUEST_SUBMITTED" | "REQUEST_STATUS_CHANGED" | "PAYMENT_RECEIVED" | "PICKUP_SCHEDULED" | "RETURN_RECEIVED" | "STORE_CREDIT_ISSUED" | "REFUND_PROCESSING" | "REFUND_COMPLETED";
export type DashboardOrderRequestTimelineEventDto = { id: string; type: DashboardOrderRequestTimelineEventType; label: string; occurredAt: string; amount?: { amountPaise: number; currency: string } | null };
export type DashboardOrderRequestTimelineItemDto = { id: string; requestType: DashboardOrderRequestTimelineRequestType; requestId: string; createdAt: string; updatedAt: string; currentStatus: string; statusLabel: string; title: string; subtitle: string; events: DashboardOrderRequestTimelineEventDto[] };
export type DashboardOrderRequestTimelineDto = DashboardOrderRequestTimelineItemDto[];

export type DashboardOrderDto = { id: string; shopifyOrderId: string | null; orderNumber: string; createdAt: string; processedAt: string | null; currency: string; amounts: DashboardOrderAmountsDto; financialStatus: DashboardStatusDto; fulfillmentStatus: DashboardStatusDto; itemCount: number; items: DashboardOrderItemDto[]; tracking: DashboardTrackingDto; actions: DashboardOrderActionsDto; requests: DashboardOrderRequestsDto; timeline: DashboardOrderRequestTimelineDto; payment: DashboardPaymentSummaryDto };

export type DashboardModulesDto = { wallet: boolean; cancellation: boolean; exchange: boolean; issueReporting: boolean; shipmentTracking: boolean; partialCod: boolean; loyalty: boolean; memberships: boolean; referrals: boolean };
