import assert from "node:assert/strict";
import test from "node:test";
import { ensurePaymentCustomization, PAYMENT_CUSTOMIZATION_TITLE } from "./payment-customization.ts";

function graphqlStub(handlers: Record<string, unknown>) {
  const calls: string[] = [];
  const graphql = (async (query: string) => {
    if (query.includes("shopifyFunctions")) { calls.push("functions"); return handlers.functions; }
    if (query.includes("paymentCustomizations")) { calls.push("list"); return handlers.list; }
    if (query.includes("paymentCustomizationCreate")) { calls.push("create"); return handlers.create; }
    if (query.includes("paymentCustomizationUpdate")) { calls.push("update"); return handlers.update; }
    throw new Error("unexpected query");
  }) as Parameters<typeof ensurePaymentCustomization>[1]["graphql"];
  return { graphql, calls };
}

const FN = { shopifyFunctions: { nodes: [{ id: "gid://shopify/Function/1", title: "loopd2c-payment-customization", apiType: "payment_customization" }] } };

test("creates + enables when no customization exists", async () => {
  const { graphql, calls } = graphqlStub({
    functions: FN,
    list: { paymentCustomizations: { nodes: [] } },
    create: { paymentCustomizationCreate: { paymentCustomization: { id: "gid://shopify/PaymentCustomization/9", enabled: true }, userErrors: [] } },
  });
  const res = await ensurePaymentCustomization("shop.myshopify.com", { graphql });
  assert.deepEqual(res, { ok: true, id: "gid://shopify/PaymentCustomization/9", created: true, enabled: true });
  assert.ok(calls.includes("create"));
});

test("idempotent: does nothing when one already exists and is enabled", async () => {
  const { graphql, calls } = graphqlStub({
    functions: FN,
    list: { paymentCustomizations: { nodes: [{ id: "gid://x/5", title: PAYMENT_CUSTOMIZATION_TITLE, enabled: true }] } },
  });
  const res = await ensurePaymentCustomization("shop.myshopify.com", { graphql });
  assert.deepEqual(res, { ok: true, id: "gid://x/5", created: false, enabled: true });
  assert.ok(!calls.includes("create"));
});

test("re-enables an existing but disabled customization", async () => {
  const { graphql, calls } = graphqlStub({
    functions: FN,
    list: { paymentCustomizations: { nodes: [{ id: "gid://x/5", title: PAYMENT_CUSTOMIZATION_TITLE, enabled: false }] } },
    update: { paymentCustomizationUpdate: { paymentCustomization: { id: "gid://x/5", enabled: true }, userErrors: [] } },
  });
  const res = await ensurePaymentCustomization("shop.myshopify.com", { graphql });
  assert.deepEqual(res, { ok: true, id: "gid://x/5", created: false, enabled: true });
  assert.ok(calls.includes("update"));
});

test("fails cleanly when the Function is not deployed yet", async () => {
  const { graphql } = graphqlStub({ functions: { shopifyFunctions: { nodes: [] } } });
  const res = await ensurePaymentCustomization("shop.myshopify.com", { graphql });
  assert.deepEqual(res, { ok: false, reason: "payment_customization_function_not_deployed" });
});

test("surfaces a create userError", async () => {
  const { graphql } = graphqlStub({
    functions: FN,
    list: { paymentCustomizations: { nodes: [] } },
    create: { paymentCustomizationCreate: { paymentCustomization: null, userErrors: [{ message: "boom" }] } },
  });
  const res = await ensurePaymentCustomization("shop.myshopify.com", { graphql });
  assert.deepEqual(res, { ok: false, reason: "boom" });
});
