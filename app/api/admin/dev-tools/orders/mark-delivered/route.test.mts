import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("route requires authenticated admin resolution and never accepts body shopId", () => {
  assert.match(source, /resolved\.hmacVerified/);
  assert.match(source, /"shopId" in input/);
  assert.match(source, /shopId: resolved\.shop\.id/);
});

test("admin helper is isolated from app proxy and disables automations", () => {
  assert.doesNotMatch(source, /app-proxy|customer session|review-request-token/);
  assert.match(source, /runDeliveryAutomations: false/);
  assert.match(source, /automationsExecuted: false/);
});
