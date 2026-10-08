import assert from "node:assert/strict";
import test from "node:test";
import { templateInboxText } from "./meta-cloud-api.ts";

test("template sends show the values the customer saw", () => {
  assert.equal(templateInboxText({ templateName: "order_out_for_delivery", variables: ["Asha", "522421", "₹1,195 (Cash on Delivery)"] }), "Template: order_out_for_delivery · Asha · 522421 · ₹1,195 (Cash on Delivery)");
  assert.equal(templateInboxText({ templateName: "cod_order_confirmation", components: [{ type: "body", parameters: [{ type: "text", text: "Asha" }, { type: "text", text: "522440" }] }, { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: "codc:confirm:1" }] }] }), "Template: cod_order_confirmation · Asha · 522440");
  assert.equal(templateInboxText({ templateName: "checkout_recovery", components: [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "token" }] }] }), "Template: checkout_recovery");
});
