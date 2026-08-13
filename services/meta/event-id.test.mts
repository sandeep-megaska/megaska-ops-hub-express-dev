import assert from "node:assert/strict";
import test from "node:test";
import { deterministicEventId as serverEventId } from "./capi.ts";
import { buildEventIdInput, normalizeOrderSourceId } from "./event-id.ts";
// Import the REAL storefront Web Pixel derivation (browser mirror). It uses only
// Web APIs (crypto.subtle, TextEncoder) that Node provides as globals, so the
// exact file the pixel ships runs here and we assert parity with the server.
import {
  deterministicEventId as browserEventId,
  normalizeOrderSourceId as browserNormalize,
  purchaseEventIdFromOrderId,
} from "../../extensions/megaska-meta-pixel/src/event-id.js";

const ORDER_ID_SHAPES = [
  "5566778899",
  5566778899,
  "gid://shopify/Order/5566778899",
  "#5566778899",
  " 5566778899 ",
];

test("normalizeOrderSourceId reduces every order-id shape to the bare numeric id", () => {
  for (const shape of ORDER_ID_SHAPES) {
    assert.equal(normalizeOrderSourceId(shape), "5566778899", `server: ${String(shape)}`);
    assert.equal(browserNormalize(shape), "5566778899", `browser: ${String(shape)}`);
  }
  assert.equal(normalizeOrderSourceId(""), "");
  assert.equal(normalizeOrderSourceId(null), "");
  assert.equal(browserNormalize(undefined), "");
});

test("buildEventIdInput is the exact hashed string contract", () => {
  assert.equal(buildEventIdInput("Purchase", "5566778899"), "Purchase:5566778899");
});

test("server and storefront Pixel derive the IDENTICAL Purchase event_id", async () => {
  for (const shape of ORDER_ID_SHAPES) {
    const sourceId = normalizeOrderSourceId(shape);
    const server = serverEventId("Purchase", sourceId);
    const browser = await browserEventId("Purchase", sourceId);
    assert.equal(browser, server, `event_id mismatch for ${String(shape)}`);
    assert.equal(browser.length, 32);
  }
});

test("purchaseEventIdFromOrderId matches the server for a GID input (end-to-end dedup)", async () => {
  const gid = "gid://shopify/Order/5566778899";
  const browser = await purchaseEventIdFromOrderId(gid);
  const server = serverEventId("Purchase", normalizeOrderSourceId(gid));
  assert.equal(browser, server);
});

test("purchaseEventIdFromOrderId returns empty when no numeric id is present", async () => {
  assert.equal(await purchaseEventIdFromOrderId("no-digits-here"), "");
});

test("different orders produce different event_ids on both sides", async () => {
  assert.notEqual(serverEventId("Purchase", "1"), serverEventId("Purchase", "2"));
  assert.notEqual(await browserEventId("Purchase", "1"), await browserEventId("Purchase", "2"));
});
