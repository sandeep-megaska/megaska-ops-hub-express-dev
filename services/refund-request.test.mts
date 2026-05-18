import test from "node:test";
import assert from "node:assert/strict";

import { createRefundRequest } from "./refund-request.ts";
import { prisma } from "./db/prisma";

const originalOrderFindFirst = prisma.orderActionRequest.findFirst;
const originalRefundCreate = prisma.refundRequest.create;
const originalRefundFindUnique = prisma.refundRequest.findUnique;
const originalRefundEventCreate = prisma.refundEvent.create;

test.afterEach(() => {
  prisma.orderActionRequest.findFirst = originalOrderFindFirst;
  prisma.refundRequest.create = originalRefundCreate;
  prisma.refundRequest.findUnique = originalRefundFindUnique;
  prisma.refundEvent.create = originalRefundEventCreate;
});

test("returns existing record on duplicate creation (idempotent)", async () => {
  prisma.orderActionRequest.findFirst = async () => ({
    id: "oar-1",
    shopId: "shop-1",
    shopifyOrderId: "gid://shopify/Order/1",
    orderNumber: "#1001",
    customerProfileId: "cust-1",
    items: [{ eligibilitySnapshot: { paymentGatewayName: "Cash on Delivery" } }],
  } as never);

  prisma.refundRequest.create = async () => {
    const err = new Error("unique") as Error & { code?: string; name?: string };
    err.name = "PrismaClientKnownRequestError";
    err.code = "P2002";
    throw err;
  };

  prisma.refundRequest.findUnique = async () => ({ id: "refund-existing", status: "DETAILS_PENDING" } as never);

  const result = await createRefundRequest({
    shop: { id: "shop-1" },
    orderId: "gid://shopify/Order/1",
    amount: 1200,
    reason: "Customer return",
    source: "ORDER_ACTION_REQUEST",
    sourceId: "src-1",
    customer: { id: "cust-1" },
  });

  assert.equal(result.id, "refund-existing");
});

test("sets COD refunds to MANUAL_PENDING initially", async () => {
  const eventCalls: Array<{ toStatus?: string | null; eventType?: string }> = [];

  prisma.orderActionRequest.findFirst = async () => ({
    id: "oar-2",
    shopId: "shop-1",
    shopifyOrderId: "gid://shopify/Order/2",
    orderNumber: "#1002",
    customerProfileId: "cust-1",
    items: [{ eligibilitySnapshot: { paymentGatewayName: "COD" } }],
  } as never);

  prisma.refundRequest.create = async ({ data }) => ({ id: "refund-1", ...data } as never);
  prisma.refundEvent.create = async ({ data }) => {
    eventCalls.push({ toStatus: (data as { toStatus?: string }).toStatus, eventType: (data as { eventType?: string }).eventType });
    return { id: "evt-1", ...data } as never;
  };

  const created = await createRefundRequest({
    shop: { id: "shop-1" },
    orderId: "gid://shopify/Order/2",
    amount: 1500,
    reason: "Issue approved",
    source: "ORDER_ACTION_REQUEST",
    sourceId: "src-2",
    customer: { id: "cust-1" },
  });

  assert.equal(created.status, "MANUAL_PENDING");
  assert.equal(eventCalls.length, 1);
  assert.equal(eventCalls[0]?.eventType, "REFUND_REQUEST_CREATED");
  assert.equal(eventCalls[0]?.toStatus, "MANUAL_PENDING");
});
