import assert from "node:assert/strict";
import test from "node:test";
import { accountErrorCode, EMAIL_EVERY_MS, failureAlertText, noteTemplateStatuses, type TemplateHealthDeps } from "./template-health.ts";

const NOW = new Date("2026-11-05T12:00:00Z");
const failed = (id: string, code = 130429, title = "Rate limit hit") => ({ id, status: "failed", errors: [{ code, title }] });

function harness(overrides: { account?: Record<string, unknown> | null; templates?: string[]; failures?: number; claim?: boolean } = {}) {
  const account = overrides.account === null ? null : { shopId: "s1", displayPhoneNumber: "+91 96393 90404", templateFailingSince: null as Date | null, templateAlertEmailedAt: null as Date | null, ...overrides.account };
  const templates = new Set(overrides.templates ?? ["t1", "t2", "otp1"]);
  const calls = { emails: [] as Array<Record<string, string>>, marked: [] as string[], cleared: 0 };
  const deps: TemplateHealthDeps = {
    findAccount: async () => account as never,
    isTemplate: async (id) => templates.has(id),
    recentFailures: async () => overrides.failures ?? 5,
    markFailing: async (_shop, error) => { calls.marked.push(error); },
    claimEmail: async () => overrides.claim ?? true,
    sendEmail: async (input) => { calls.emails.push(input); },
    clear: async () => { calls.cleared++; },
    now: () => NOW,
  };
  return { deps, calls };
}

test("account-level error codes are recognised", () => {
  assert.equal(accountErrorCode("130429 Rate limit hit"), 130429);
  assert.equal(accountErrorCode("131042 Business eligibility payment issue"), 131042);
  assert.equal(accountErrorCode("131026 Message undeliverable"), null);
  assert.equal(accountErrorCode(null), null);
});

test("five template failures with an account-level error email the merchant once", async () => {
  const { deps, calls } = harness();
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", deps), "alerted");
  assert.deepEqual(calls.marked, ["130429 Rate limit hit"]);
  assert.equal(calls.emails.length, 1);
  assert.equal(calls.emails[0].subject, "WhatsApp messages from +91 96393 90404 are failing");
  assert.match(calls.emails[0].text, /prepaid balance has run out/);
  assert.match(calls.emails[0].text, /Billing & payments → Messaging accounts/);
});

test("no email below the threshold, for one customer's problem, or for free messages", async () => {
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", harness({ failures: 4 }).deps), "below_threshold");
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1", 131026, "Message undeliverable")] }, "pn1", harness().deps), "nothing");
  assert.equal(await noteTemplateStatuses({ statuses: [failed("free1")] }, "pn1", harness().deps), "nothing");
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", harness({ account: null }).deps), "no_account");
  assert.equal(await noteTemplateStatuses({ statuses: [] }, "pn1", harness().deps), "no_statuses");
});

test("the email repeats at most every 12 hours, and only one webhook sends it", async () => {
  const recent = harness({ account: { templateFailingSince: NOW, templateAlertEmailedAt: new Date(NOW.getTime() - EMAIL_EVERY_MS + 60_000) } });
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", recent.deps), "already_alerted");
  assert.equal(recent.calls.emails.length, 0);
  const raced = harness({ claim: false });
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", raced.deps), "already_alerted");
  assert.equal(raced.calls.emails.length, 0);
  const later = harness({ account: { templateFailingSince: NOW, templateAlertEmailedAt: new Date(NOW.getTime() - EMAIL_EVERY_MS - 1) } });
  assert.equal(await noteTemplateStatuses({ statuses: [failed("t1")] }, "pn1", later.deps), "alerted");
});

test("a delivered template clears the warning", async () => {
  const { deps, calls } = harness({ account: { templateFailingSince: NOW } });
  assert.equal(await noteTemplateStatuses({ statuses: [{ id: "otp1", status: "delivered" }] }, "pn1", deps), "recovered");
  assert.equal(calls.cleared, 1);
  const quiet = harness();
  assert.equal(await noteTemplateStatuses({ statuses: [{ id: "otp1", status: "read" }] }, "pn1", quiet.deps), "nothing");
});

test("the alert text names the code and the fix", () => {
  const { text } = failureAlertText({ phone: "+91 1", failures: 7, code: 131042 });
  assert.match(text, /7 WhatsApp template messages from \+91 1 were rejected by Meta with error 131042/);
  assert.match(text, /OTP codes go by SMS automatically/);
});
