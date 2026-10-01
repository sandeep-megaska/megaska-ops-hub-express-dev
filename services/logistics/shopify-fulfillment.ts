// Marks a Shopify order fulfilled with the courier's AWB, so Shopify shows it
// as shipped and (optionally) emails the customer the tracking link. Needs the
// read/write_merchant_managed_fulfillment_orders scopes.

type GraphqlFn = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

// Must match Shopify's supported tracking company name exactly so the AWB is
// clickable in the admin and the shipping email.
export const DELHIVERY_TRACKING_COMPANY = "Delhivery";

export const ORDER_FULFILLMENT_ORDERS_QUERY = `
  query OrderFulfillmentOrders($id: ID!) {
    order(id: $id) {
      id
      displayFulfillmentStatus
      fulfillmentOrders(first: 20) {
        nodes {
          id
          status
          supportedActions { action }
          lineItems(first: 100) { nodes { id remainingQuantity } }
        }
      }
    }
  }
`;

export const FULFILLMENT_CREATE_MUTATION = `
  mutation CreateCourierFulfillment($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

type FulfillmentOrderNode = {
  id: string;
  status: string;
  supportedActions?: Array<{ action: string }> | null;
  lineItems?: { nodes?: Array<{ id: string; remainingQuantity: number }> } | null;
};

export class ShopifyFulfillmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyFulfillmentError";
  }
}

export type ShopifyFulfillmentOutcome =
  | { outcome: "fulfilled"; fulfillmentId: string | null }
  | { outcome: "already_fulfilled" };

function hasRemaining(node: FulfillmentOrderNode) {
  return (node.lineItems?.nodes || []).some((item) => Number(item.remainingQuantity) > 0);
}

function canFulfill(node: FulfillmentOrderNode) {
  return (
    ["OPEN", "IN_PROGRESS"].includes(String(node.status).toUpperCase()) &&
    (node.supportedActions || []).some((entry) => entry.action === "CREATE_FULFILLMENT") &&
    hasRemaining(node)
  );
}

/** Splits fulfillment orders into ones we can fulfil now and the reason if none. */
export function selectFulfillableOrders(nodes: FulfillmentOrderNode[]) {
  const fulfillable = nodes.filter(canFulfill);
  if (fulfillable.length) return { fulfillable, alreadyFulfilled: false, blockedReason: null as string | null };

  const pending = nodes.filter((node) => hasRemaining(node) && !["CLOSED", "CANCELLED", "INCOMPLETE"].includes(String(node.status).toUpperCase()));
  if (!pending.length) return { fulfillable, alreadyFulfilled: true, blockedReason: null };

  const statuses = Array.from(new Set(pending.map((node) => String(node.status).toLowerCase().replace(/_/g, " "))));
  return {
    fulfillable,
    alreadyFulfilled: false,
    blockedReason: `Shopify can't fulfil this order yet (fulfillment order ${statuses.join(", ")}). Release holds or fulfillment-service requests in Shopify, then retry.`,
  };
}

export function friendlyShopifyFulfillmentError(message: string) {
  if (/access denied|required access|merchant_managed_fulfillment_orders|not approved|scope/i.test(message)) {
    return "LoopD2C doesn't have permission to fulfil orders yet. Open the app in Shopify admin and approve the updated permissions, then retry.";
  }
  return message;
}

export async function fulfillOrderWithTracking(input: {
  graphql: GraphqlFn;
  orderId: string;
  awb: string;
  trackingUrl: string | null;
  notifyCustomer: boolean;
}): Promise<ShopifyFulfillmentOutcome> {
  let data: { order: { fulfillmentOrders: { nodes: FulfillmentOrderNode[] } } | null };
  try {
    data = await input.graphql(ORDER_FULFILLMENT_ORDERS_QUERY, { id: input.orderId });
  } catch (error) {
    throw new ShopifyFulfillmentError(friendlyShopifyFulfillmentError(error instanceof Error ? error.message : String(error)));
  }
  if (!data.order) throw new ShopifyFulfillmentError("Order not found in Shopify.");

  const selection = selectFulfillableOrders(data.order.fulfillmentOrders.nodes || []);
  if (selection.alreadyFulfilled) return { outcome: "already_fulfilled" };
  if (!selection.fulfillable.length) throw new ShopifyFulfillmentError(selection.blockedReason || "Nothing left to fulfil.");

  let result: { fulfillmentCreate: { fulfillment: { id: string } | null; userErrors: Array<{ message: string }> } | null };
  try {
    result = await input.graphql(FULFILLMENT_CREATE_MUTATION, {
      fulfillment: {
        // No line items listed → every remaining item of each fulfillment order ships.
        lineItemsByFulfillmentOrder: selection.fulfillable.map((node) => ({ fulfillmentOrderId: node.id })),
        trackingInfo: {
          company: DELHIVERY_TRACKING_COMPANY,
          number: input.awb,
          ...(input.trackingUrl ? { url: input.trackingUrl } : {}),
        },
        notifyCustomer: input.notifyCustomer,
      },
    });
  } catch (error) {
    throw new ShopifyFulfillmentError(friendlyShopifyFulfillmentError(error instanceof Error ? error.message : String(error)));
  }

  const userErrors = result.fulfillmentCreate?.userErrors || [];
  if (userErrors.length || !result.fulfillmentCreate) {
    throw new ShopifyFulfillmentError(friendlyShopifyFulfillmentError(userErrors.map((entry) => entry.message).join("; ") || "Shopify did not create the fulfillment."));
  }
  return { outcome: "fulfilled", fulfillmentId: result.fulfillmentCreate.fulfillment?.id || null };
}
