// The WhatsApp templates for customer updates on exchanges (services/notifications/
// exchange-milestones.ts) and on cancellations, issue reports and refunds
// (services/notifications/request-updates.ts), and submitting them to Meta from the shop's own
// WhatsApp Business Account so the merchant doesn't write them by hand. Each body's {{n}} match
// what the step sends: {{1}} customer name, {{2}} order number (without #) or refund amount,
// then the order number or AWB where present.

export type ExchangeTemplateDraft = { key: string; name: string; body: string; examples: string[] };

// Default names; WHATSAPP_TEMPLATE_EXCHANGE_<KEY> overrides one (the same rule the sender uses).
export const EXCHANGE_TEMPLATE_NAMES = {
  APPROVED: "exchange_approved",
  PAYMENT_RECEIVED: "exchange_payment_received",
  PICKUP_SCHEDULED: "exchange_pickup_scheduled",
  PICKUP_COMPLETED: "exchange_pickup_completed",
  ITEM_RECEIVED: "exchange_item_received",
  REPLACEMENT_PROCESSING: "exchange_replacement_processing",
  REPLACEMENT_SHIPPED: "exchange_replacement_shipped",
  CLOSED: "exchange_completed",
  REJECTED: "exchange_rejected",
} as const;

const BODIES: Record<keyof typeof EXCHANGE_TEMPLATE_NAMES, string> = {
  APPROVED: "Hi {{1}}, your exchange request for order #{{2}} has been approved. We'll message you here with the next steps for returning your item.",
  PAYMENT_RECEIVED: "Hi {{1}}, we've received your payment for the exchange of order #{{2}}. We're arranging the pickup of your item and will share the details here.",
  PICKUP_SCHEDULED: "Hi {{1}}, the pickup for your exchange of order #{{2}} is scheduled. Pickup tracking number (AWB): {{3}}. Please keep the item packed and ready.",
  PICKUP_COMPLETED: "Hi {{1}}, we've picked up the item for your exchange of order #{{2}}. We'll update you here once it reaches us.",
  ITEM_RECEIVED: "Hi {{1}}, we've received the item for your exchange of order #{{2}}. We're checking it and will process your replacement.",
  REPLACEMENT_PROCESSING: "Hi {{1}}, your replacement for order #{{2}} is being prepared. We'll share the tracking details here once it ships.",
  REPLACEMENT_SHIPPED: "Hi {{1}}, your replacement for order #{{2}} has been shipped. Tracking number (AWB): {{3}}. Thank you for your patience.",
  CLOSED: "Hi {{1}}, your exchange for order #{{2}} is complete. Thank you for shopping with us!",
  REJECTED: "Hi {{1}}, we're sorry, we couldn't approve the exchange request for order #{{2}}. Reply here if you'd like to know more or need help.",
};

const EXAMPLES = ["Asha", "1042", "ABC123456789"];

// Cancellations, issue reports and refunds (override names with WHATSAPP_TEMPLATE_<KEY>).
export const REQUEST_TEMPLATE_NAMES = {
  CANCELLATION_APPROVED: "cancellation_approved",
  CANCELLATION_REJECTED: "cancellation_rejected",
  CANCELLATION_CLOSED: "order_cancelled",
  ISSUE_OPEN: "issue_received",
  ISSUE_APPROVED: "issue_approved",
  ISSUE_REJECTED: "issue_rejected",
  ISSUE_CLOSED: "issue_resolved",
  REFUND_PAID: "refund_paid",
} as const;

const REQUEST_BODIES: Record<keyof typeof REQUEST_TEMPLATE_NAMES, { body: string; examples: string[] }> = {
  CANCELLATION_APPROVED: { body: "Hi {{1}}, your cancellation request for order #{{2}} has been approved. We'll confirm here once the order is cancelled.", examples: ["Asha", "1042"] },
  CANCELLATION_REJECTED: { body: "Hi {{1}}, we're sorry, we couldn't accept the cancellation request for order #{{2}}. Reply here and our team will explain and help.", examples: ["Asha", "1042"] },
  CANCELLATION_CLOSED: { body: "Hi {{1}}, your order #{{2}} has been cancelled. If you paid online, we'll confirm your refund here.", examples: ["Asha", "1042"] },
  ISSUE_OPEN: { body: "Hi {{1}}, we've received your report about order #{{2}}. Our team will review it and update you here.", examples: ["Asha", "1042"] },
  ISSUE_APPROVED: { body: "Hi {{1}}, we've reviewed your report about order #{{2}} and approved it. We'll message you here with the next steps.", examples: ["Asha", "1042"] },
  ISSUE_REJECTED: { body: "Hi {{1}}, we've reviewed your report about order #{{2}}, but we couldn't approve it. Reply here if you'd like to know more.", examples: ["Asha", "1042"] },
  ISSUE_CLOSED: { body: "Hi {{1}}, your report about order #{{2}} has been resolved. Thank you for your patience.", examples: ["Asha", "1042"] },
  REFUND_PAID: { body: "Hi {{1}}, we've sent your refund of {{2}} for order #{{3}}. Depending on your bank or payment method, it can take a few working days to show.", examples: ["Asha", "₹1,195", "1042"] },
};

export function exchangeTemplateName(key: string, env: Record<string, string | undefined> = process.env) {
  if (key in REQUEST_TEMPLATE_NAMES) return String(env[`WHATSAPP_TEMPLATE_${key}`] ?? "").trim() || REQUEST_TEMPLATE_NAMES[key as keyof typeof REQUEST_TEMPLATE_NAMES];
  const override = String(env[`WHATSAPP_TEMPLATE_EXCHANGE_${key}`] ?? "").trim();
  return override || EXCHANGE_TEMPLATE_NAMES[key as keyof typeof EXCHANGE_TEMPLATE_NAMES];
}

// Every update template: the nine exchange steps, then cancellations, issue reports and refunds.
export function exchangeTemplateDrafts(env: Record<string, string | undefined> = process.env): ExchangeTemplateDraft[] {
  const exchange = (Object.keys(EXCHANGE_TEMPLATE_NAMES) as Array<keyof typeof EXCHANGE_TEMPLATE_NAMES>).map((key) => {
    const body = BODIES[key];
    const count = new Set(body.match(/\{\{\d+\}\}/g) ?? []).size;
    return { key, name: exchangeTemplateName(key, env), body, examples: EXAMPLES.slice(0, count) };
  });
  const requests = (Object.keys(REQUEST_TEMPLATE_NAMES) as Array<keyof typeof REQUEST_TEMPLATE_NAMES>).map((key) => ({ key, name: exchangeTemplateName(key, env), ...REQUEST_BODIES[key] }));
  return [...exchange, ...requests];
}

type Fetcher = typeof fetch;
export type TemplateSetupResult = { created: string[]; existing: Array<{ name: string; status: string }>; failed: Array<{ name: string; error: string }> };

// Templates already on the account (any language), so nothing is submitted twice.
async function existingTemplates(input: { wabaId: string; accessToken: string; graphVersion: string }, fetcher: Fetcher) {
  const found = new Map<string, string>();
  let url: string | null = `https://graph.facebook.com/${input.graphVersion}/${encodeURIComponent(input.wabaId)}/message_templates?fields=name,status,language&limit=200`;
  for (let page = 0; url && page < 10; page++) {
    const response: Response = await fetcher(url, { headers: { Authorization: `Bearer ${input.accessToken}` }, cache: "no-store" });
    const data = (await response.json().catch(() => null)) as { data?: Array<{ name?: string; status?: string; language?: string }>; paging?: { next?: string }; error?: { message?: string } } | null;
    if (!response.ok) throw new Error(`Meta didn't list the account's templates: ${data?.error?.message || `HTTP ${response.status}`}`);
    for (const template of data?.data ?? []) if (template.name) found.set(`${template.name}:${template.language ?? ""}`, String(template.status ?? "UNKNOWN"));
    const next: string | undefined = data?.paging?.next;
    url = next && new URL(next).host === "graph.facebook.com" ? next : null;
  }
  return found;
}

export async function submitExchangeTemplates(input: { wabaId: string; accessToken: string; language: string; graphVersion?: string; env?: Record<string, string | undefined> }, fetcher: Fetcher = fetch): Promise<TemplateSetupResult> {
  const graphVersion = (input.graphVersion || String(process.env.WHATSAPP_META_GRAPH_VERSION || "v20.0")).trim().replace(/^\/+|\/+$/g, "");
  const language = input.language || "en";
  const existing = await existingTemplates({ wabaId: input.wabaId, accessToken: input.accessToken, graphVersion }, fetcher);
  const result: TemplateSetupResult = { created: [], existing: [], failed: [] };
  for (const draft of exchangeTemplateDrafts(input.env)) {
    const status = existing.get(`${draft.name}:${language}`);
    if (status) { result.existing.push({ name: draft.name, status }); continue; }
    const response = await fetcher(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(input.wabaId)}/message_templates`, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: draft.name, language, category: "UTILITY", components: [{ type: "BODY", text: draft.body, example: { body_text: [draft.examples] } }] }),
    });
    const data = (await response.json().catch(() => null)) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } } | null;
    if (response.ok && data?.id) result.created.push(draft.name);
    else if (/already exists/i.test(String(data?.error?.error_user_msg || data?.error?.message))) result.existing.push({ name: draft.name, status: "EXISTS" });
    else result.failed.push({ name: draft.name, error: String(data?.error?.error_user_msg || data?.error?.message || `HTTP ${response.status}`).slice(0, 200) });
  }
  return result;
}

// One line for the settings page.
export function templateSetupSummary(result: TemplateSetupResult) {
  const approved = result.existing.filter((item) => item.status === "APPROVED").length;
  const waiting = result.existing.length - approved;
  const parts = [
    result.created.length ? `${result.created.length} submitted to Meta for review` : null,
    approved ? `${approved} already approved` : null,
    waiting ? `${waiting} already submitted (${[...new Set(result.existing.filter((item) => item.status !== "APPROVED").map((item) => item.status.toLowerCase()))].join(", ")})` : null,
    result.failed.length ? `${result.failed.length} failed: ${result.failed.map((item) => `${item.name} (${item.error})`).join("; ")}` : null,
  ].filter(Boolean);
  const allApproved = !result.created.length && !result.failed.length && approved === result.existing.length;
  return `Update templates: ${parts.join(", ")}.${allApproved ? " You can switch on customer updates." : result.failed.length ? "" : " Meta usually reviews utility templates within minutes to a day; switch on customer updates once they're approved."}`;
}
