import assert from "node:assert/strict";
import test from "node:test";
import { getSetupProgress } from "./setup-progress.ts";

const all = (value: boolean) => ({ planApproved: async () => value, branding: async () => value, checkoutSettings: async () => value, delhivery: async () => value, gst: async () => value });

test("counts completed steps and points to the first one left", async () => {
  const progress = await getSetupProgress("shop-a", { ...all(false), planApproved: async () => true, branding: async () => true });
  assert.equal(progress.completed, 2);
  assert.equal(progress.total, 5);
  assert.deepEqual(progress.next, { id: "checkoutSettings", label: "Set prepaid offer & COD", done: false, href: "/admin/checkout" });
  assert.deepEqual(progress.steps.map((step) => step.done), [true, true, false, false, false]);
});

test("everything done leaves no next step", async () => {
  const progress = await getSetupProgress("shop-a", all(true));
  assert.equal(progress.completed, 5);
  assert.equal(progress.next, null);
});

test("a check that fails counts as not done instead of breaking the home page", async () => {
  const progress = await getSetupProgress("shop-a", { ...all(true), gst: async () => { throw new Error("db down"); } });
  assert.equal(progress.completed, 4);
  assert.equal(progress.next?.id, "gst");
});
