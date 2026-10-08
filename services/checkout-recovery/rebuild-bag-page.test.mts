import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { rebuildBagPage } from "./rebuild-bag-page.ts";

// Runs the page's script against a fake storefront: `responses` scripts the
// status of each cart request in order (default 200), and the drawer controller
// reports an error for its first `drawerErrors` opens.
async function runBagScript(input: { responses?: number[]; drawerErrors?: number; controllerAfterMs?: number }) {
  const html = rebuildBagPage([{ variantId: 11, quantity: 2 }], "bag", { source: "whatsapp_cart" });
  const script = html.slice(html.indexOf("<script>") + 8, html.indexOf("</script>"));
  const requests: string[] = [];
  const statuses = [...(input.responses ?? [])];
  const status = { textContent: "" };
  let opens = 0;
  const drawerErrors = input.drawerErrors ?? 0;
  const window: { location: { href: string }; fetch: unknown; LoopDeskCartController?: unknown } = {
    location: { href: "/apps/loopd2c/checkout/bag" },
    fetch: async (url: string, init: { body?: string }) => {
      const code = statuses.shift() ?? 200;
      requests.push(`${code} ${url} ${init.body ?? ""}`);
      return { ok: code < 300, status: code, json: async () => ({}) };
    },
  };
  const controller = {
    open: async () => { opens += 1; },
    getState: () => ({ error: opens <= drawerErrors ? "Cart request failed" : "" }),
  };
  setTimeout(() => { window.LoopDeskCartController = controller; }, input.controllerAfterMs ?? 0);
  vm.runInNewContext(script, { window, document: { getElementById: () => status }, setTimeout, Promise, JSON });
  await new Promise((resolve) => setTimeout(resolve, 4000));
  return { requests, opens, status: status.textContent, href: window.location.href };
}

test("the bag is rebuilt one request at a time and the drawer opened once", async () => {
  const run = await runBagScript({});
  assert.deepEqual(run.requests.map((line) => line.split(" ").slice(0, 2).join(" ")), ["200 /cart/clear.js", "200 /cart/add.js", "200 /cart/update.js"]);
  assert.match(run.requests[1], /"items":\[\{"id":11,"quantity":2\}\]/);
  assert.match(run.requests[2], /"loopd2c_source":"whatsapp_cart"/);
  assert.equal(run.opens, 1);
  assert.match(run.status, /Your bag is ready/);
  assert.equal(run.href, "/apps/loopd2c/checkout/bag");
});

test("a 409 from Shopify (overlapping cart requests) is retried, not treated as out of stock", async () => {
  const run = await runBagScript({ responses: [200, 409, 409, 200, 200] });
  assert.deepEqual(run.requests.map((line) => line.split(" ").slice(0, 2).join(" ")), ["200 /cart/clear.js", "409 /cart/add.js", "409 /cart/add.js", "200 /cart/add.js", "200 /cart/update.js"]);
  assert.match(run.status, /Your bag is ready/);
});

test("the drawer is reopened when its first load failed, and the cart page is the last resort", async () => {
  const recovered = await runBagScript({ drawerErrors: 1, controllerAfterMs: 400 });
  assert.equal(recovered.opens, 2);
  assert.match(recovered.status, /Your bag is ready/);
  assert.equal(recovered.href, "/apps/loopd2c/checkout/bag");

  const broken = await runBagScript({ drawerErrors: 10 });
  assert.equal(broken.opens, 4);
  assert.equal(broken.href, "/cart");
});
