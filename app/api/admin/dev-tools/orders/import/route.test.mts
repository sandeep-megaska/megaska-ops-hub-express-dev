import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");

test("route derives a verified embedded-admin tenant and rejects body shopId", () => {
  assert.match(source, /resolveAdminShopFromRequest\(request\)/);
  assert.match(source, /resolved\.hmacVerified/);
  assert.match(source, /"shopId" in input/);
  assert.match(source, /shopId: resolved\.shop\.id/);
  assert.match(source, /shopDomain: resolved\.shop\.shopDomain/);
});

test("admin import is proxy isolated and has no automation or email path", () => {
  assert.doesNotMatch(source, /app-proxy|jsonWithCors|resolveAppProxy|send.*Email|processDue|markOrderDelivered/);
  assert.match(source, /Object\.keys\(input\).*key !== "orderId"/);
});
