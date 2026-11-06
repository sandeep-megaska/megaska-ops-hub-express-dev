import assert from "node:assert/strict";
import test from "node:test";
import { exchangeTemplateDrafts, exchangeTemplateName, submitExchangeTemplates, templateSetupSummary } from "./exchange-templates.ts";

test("utility drafts whose {{n}} match what each step sends", () => {
  const drafts = exchangeTemplateDrafts({});
  assert.equal(drafts.length, 17);
  const params = Object.fromEntries(drafts.map((draft) => [draft.key, new Set(draft.body.match(/\{\{\d+\}\}/g)).size]));
  // exchange-milestones.ts sends [name, order] everywhere and an AWB third for pickup and replacement shipped.
  assert.deepEqual(params, { APPROVED: 2, PAYMENT_RECEIVED: 2, PICKUP_SCHEDULED: 3, PICKUP_COMPLETED: 2, ITEM_RECEIVED: 2, REPLACEMENT_PROCESSING: 2, REPLACEMENT_SHIPPED: 3, CLOSED: 2, REJECTED: 2, CANCELLATION_APPROVED: 2, CANCELLATION_REJECTED: 2, CANCELLATION_CLOSED: 2, ISSUE_OPEN: 2, ISSUE_APPROVED: 2, ISSUE_REJECTED: 2, ISSUE_CLOSED: 2, REFUND_PAID: 3 });
  for (const draft of drafts) {
    assert.equal(draft.examples.length, params[draft.key]);
    assert.match(draft.name, /^[a-z0-9_]+$/);
    assert.ok(!/^\{\{|\}\}[.!]?$/.test(draft.body), `${draft.key} must not start or end with a variable`);
  }
  assert.equal(drafts.find((draft) => draft.key === "CLOSED")!.name, "exchange_completed");
  assert.equal(drafts.find((draft) => draft.key === "CANCELLATION_CLOSED")!.name, "order_cancelled");
  assert.equal(new Set(drafts.map((draft) => draft.name)).size, 17, "names are unique");
});

test("a template name can be overridden the same way the sender reads it", () => {
  assert.equal(exchangeTemplateName("APPROVED", { WHATSAPP_TEMPLATE_EXCHANGE_APPROVED: "megaska_exchange_ok" }), "megaska_exchange_ok");
  assert.equal(exchangeTemplateDrafts({ WHATSAPP_TEMPLATE_EXCHANGE_APPROVED: "megaska_exchange_ok" })[0].name, "megaska_exchange_ok");
  assert.equal(exchangeTemplateName("REFUND_PAID", { WHATSAPP_TEMPLATE_REFUND_PAID: "megaska_refund" }), "megaska_refund");
});

function fakeMeta(existing: Array<{ name: string; status: string; language: string }>, fail: Record<string, string> = {}) {
  const posted: Array<Record<string, unknown>> = [];
  const fetcher = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    assert.ok(href.startsWith("https://graph.facebook.com/v20.0/WABA1/message_templates"));
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer TOKEN");
    if (!init?.method) return Response.json({ data: existing });
    const body = JSON.parse(String(init.body));
    posted.push(body);
    if (fail[body.name]) return Response.json({ error: { message: "Invalid parameter", error_user_msg: fail[body.name] } }, { status: 400 });
    return Response.json({ id: `t-${body.name}`, status: "PENDING", category: "UTILITY" });
  }) as typeof fetch;
  return { fetcher, posted };
}

test("only missing templates are submitted, as utility with examples, in the account's language", async () => {
  const meta = fakeMeta([{ name: "exchange_approved", status: "APPROVED", language: "en" }, { name: "exchange_completed", status: "PENDING", language: "en" }, { name: "exchange_rejected", status: "APPROVED", language: "hi" }]);
  const result = await submitExchangeTemplates({ wabaId: "WABA1", accessToken: "TOKEN", language: "en", graphVersion: "v20.0", env: {} }, meta.fetcher);
  assert.equal(meta.posted.length, 15);
  assert.ok(meta.posted.some((body) => body.name === "exchange_rejected"), "a template in another language doesn't count");
  const pickup = meta.posted.find((body) => body.name === "exchange_pickup_scheduled")!;
  assert.equal(pickup.category, "UTILITY");
  assert.equal(pickup.language, "en");
  assert.deepEqual((pickup.components as Array<{ example: { body_text: string[][] } }>)[0].example.body_text, [["Asha", "1042", "ABC123456789"]]);
  assert.deepEqual(result.existing, [{ name: "exchange_approved", status: "APPROVED" }, { name: "exchange_completed", status: "PENDING" }]);
  assert.equal(result.created.length, 15);
  assert.match(templateSetupSummary(result), /Update templates: 15 submitted to Meta for review, 1 already approved, 1 already submitted \(pending\).*switch on customer updates once they're approved/);
});

test("Meta's reasons are reported, and 'already exists' isn't a failure", async () => {
  const meta = fakeMeta([], { exchange_rejected: "Content in this language already exists", exchange_item_received: "Body text is too similar to an existing template" });
  const result = await submitExchangeTemplates({ wabaId: "WABA1", accessToken: "TOKEN", language: "en", graphVersion: "v20.0", env: {} }, meta.fetcher);
  assert.deepEqual(result.failed, [{ name: "exchange_item_received", error: "Body text is too similar to an existing template" }]);
  assert.deepEqual(result.existing, [{ name: "exchange_rejected", status: "EXISTS" }]);
  assert.match(templateSetupSummary(result), /1 failed: exchange_item_received \(Body text is too similar/);
});

test("all approved: the summary says exchange updates can be switched on", () => {
  assert.match(templateSetupSummary({ created: [], failed: [], existing: Array.from({ length: 9 }, (_, i) => ({ name: `t${i}`, status: "APPROVED" })) }), /9 already approved\. You can switch on customer updates\./);
});
