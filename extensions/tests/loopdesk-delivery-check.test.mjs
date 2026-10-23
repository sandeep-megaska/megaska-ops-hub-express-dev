import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const blockSource = fs.readFileSync(new URL("../megaska-otp-src/loopdesk-delivery-check.js", import.meta.url), "utf8");
const blockLiquid = fs.readFileSync(new URL("../megaska-otp/blocks/loopdesk-delivery-check.liquid", import.meta.url), "utf8");
const drawerSource = fs.readFileSync(new URL("../megaska-otp-src/loopdesk-cart-drawer.js", import.meta.url), "utf8");

function makeStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

// Minimal element: enough of the DOM for the block's init().
function makeElement(tag, attrs = {}) {
  const listeners = {};
  return {
    tagName: tag,
    attrs: { ...attrs },
    children: [],
    hidden: false,
    disabled: false,
    value: "",
    text: "",
    // Like the DOM: setting textContent replaces the children.
    get textContent() { return this.text; },
    set textContent(value) { this.text = String(value); this.children = []; },
    getAttribute(name) { return name in this.attrs ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type, event = {}) { return listeners[type] && listeners[type]({ preventDefault() {}, ...event }); },
    appendChild(child) { this.children.push(child); },
  };
}

function loadBlock({ storage = makeStorage(), responses = [], attrs = {} } = {}) {
  const form = makeElement("div");
  const input = makeElement("input");
  const button = makeElement("button");
  button.textContent = "Check";
  const result = makeElement("div");
  const root = makeElement("div", { "data-app-proxy-base": "/apps/loopd2c", "data-cutoff-hour": "12", "data-skip-sunday": "true", "data-show-cod": "true", ...attrs });
  root.querySelector = (selector) => ({ ".loopdesk-delivery-check__form": form, input, button, ".loopdesk-delivery-check__result": result })[selector] || null;
  const calls = [];
  const queue = [...responses];
  const events = [];
  const window = { localStorage: storage };
  const context = {
    window,
    document: {
      readyState: "complete",
      querySelectorAll: () => [root],
      addEventListener() {},
      dispatchEvent: (event) => events.push(event),
      createElement: (tag) => makeElement(tag),
    },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    fetch: async (url) => {
      calls.push(url);
      const [status, body] = queue.shift() || [500, null];
      return { status, ok: status >= 200 && status < 300, json: async () => body };
    },
    Date,
    JSON,
    Number,
    String,
  };
  vm.runInNewContext(blockSource, context);
  return { api: window.LoopD2CDeliveryCheck, root, form, input, button, result, calls, events, storage };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const lines = (result) => result.children.map((child) => child.textContent);
const serviceable = { ok: true, isServiceable: true, isCod: true, city: "Kochi", stateCode: "KL", tatDays: 3 };

test("ships the same day before the cutoff and the next day after it", () => {
  const { api } = loadBlock();
  // Tuesday 21 Oct 2026.
  assert.equal(api.shipDate(new Date(2026, 9, 20, 11, 0), { cutoffHour: 12 }).getDate(), 20);
  assert.equal(api.shipDate(new Date(2026, 9, 20, 12, 0), { cutoffHour: 12 }).getDate(), 21);
  assert.equal(api.shipDate(new Date(2026, 9, 20, 15, 0), { cutoffHour: 16 }).getDate(), 20);
});

test("skips Sundays unless the merchant dispatches on Sundays", () => {
  const { api } = loadBlock();
  const saturdayEvening = new Date(2026, 9, 24, 18, 0);
  const sunday = new Date(2026, 9, 25, 9, 0);
  assert.equal(api.shipDate(saturdayEvening, { cutoffHour: 12, skipSunday: true }).getDate(), 26);
  assert.equal(api.shipDate(sunday, { cutoffHour: 12, skipSunday: true }).getDate(), 26);
  assert.equal(api.shipDate(sunday, { cutoffHour: 12, skipSunday: false }).getDate(), 25);
});

test("describes a serviceable PIN code with place, dates and COD", () => {
  const { api } = loadBlock();
  const message = api.describe(serviceable, new Date(2026, 9, 20, 10, 0), { cutoffHour: 12, skipSunday: true, showCod: true });
  assert.equal(message.tone, "ok");
  assert.deepEqual(Array.from(message.lines), ["Delivery available to Kochi (KL)", "Expected by 23 Oct – 24 Oct", "Cash on Delivery available"]);
  const noCod = api.describe({ ...serviceable, isCod: false }, new Date(2026, 9, 20, 10, 0), { cutoffHour: 12, showCod: false });
  assert.equal(noCod.lines.length, 2);
});

test("explains unserviceable PIN codes and failed lookups to the shopper", () => {
  const { api } = loadBlock();
  assert.match(api.describe({ ok: true, isServiceable: false }, new Date(), {}).lines[0], /don't deliver/);
  assert.match(api.describe({ ok: false, error: "DELHIVERY_NOT_CONFIGURED" }, new Date(), {}).lines[0], /try again/);
  assert.match(api.describe({ ok: false, error: "DELHIVERY_NOT_CONFIGURED" }, new Date(), { designMode: true }).lines[0], /Connect Delhivery/);
});

test("looks up through the app proxy and caches the result for the bag", async () => {
  const block = loadBlock({ responses: [[200, serviceable]] });
  block.input.value = "682001";
  block.button.fire("click");
  await settle(); await settle();
  assert.deepEqual(block.calls, ["/apps/loopd2c/api/delhivery/pincode?pin=682001"]);
  assert.equal(block.result.attrs["data-tone"], "ok");
  assert.equal(lines(block.result)[0], "Delivery available to Kochi (KL)");
  const cached = JSON.parse(block.storage.getItem("loopd2c_delivery_pin_result"));
  assert.equal(cached.pin, "682001");
  assert.equal(cached.tatDays, 3);
  assert.equal(cached.cutoffHour, 12);
  assert.equal(cached.skipSunday, true);
  assert.equal(block.events[0].type, "loopd2c:delivery-checked");
  assert.equal(block.button.disabled, false);
  assert.equal(block.button.textContent, "Check");
});

test("rejects an invalid PIN code without a lookup", () => {
  const block = loadBlock();
  block.input.value = "6820";
  block.button.fire("click");
  assert.equal(block.calls.length, 0);
  assert.equal(block.input.attrs["aria-invalid"], "true");
  assert.equal(block.result.attrs["data-tone"], "error");
});

test("hides itself when the module is switched off for the shop", async () => {
  const block = loadBlock({ responses: [[403, { ok: false }]] });
  block.input.value = "682001";
  block.button.fire("click");
  await settle(); await settle();
  assert.equal(block.root.hidden, true);
  assert.equal(block.storage.getItem("loopd2c_delivery_pin_result"), null);
});

test("prefills the last checked PIN code", () => {
  const storage = makeStorage({ loopd2c_delivery_pin_result: JSON.stringify({ pin: "560001" }) });
  const block = loadBlock({ storage });
  assert.equal(block.input.value, "560001");
});

test("the block is limited to product templates and uses the app proxy", () => {
  const schema = JSON.parse(blockLiquid.split("{% schema %}")[1].split("{% endschema %}")[0]);
  assert.equal(schema.name, "LoopD2C Delivery check");
  assert.deepEqual(schema.enabled_on, { templates: ["product"] });
  assert.match(blockLiquid, /data-app-proxy-base="\/apps\/loopd2c"/);
  assert.match(blockLiquid, /autocomplete="postal-code"/);
  // No <form>: inside a product form it would be dropped and Check would submit Add to bag.
  assert.doesNotMatch(blockLiquid.split("{% schema %}")[0].replace(/\{%-? comment -?%\}[\s\S]*?\{%-? endcomment -?%\}/g, ""), /<form/i);
  assert.match(blockLiquid, /<button type="button"/);
  // Inside a product form the PIN field must not be posted with Add to bag, and a
  // half-typed PIN must not fail the browser's form validation and block it.
  const input = blockLiquid.match(/<input[\s\S]*?>/)[0];
  assert.doesNotMatch(input, /\sname=/);
  assert.doesNotMatch(input, /\s(pattern|required|minlength)=/);
});

test("Enter in the PIN field checks without submitting a surrounding form", async () => {
  const block = loadBlock({ responses: [[200, serviceable]] });
  block.input.value = "682001";
  let prevented = false;
  block.input.fire("keydown", { key: "Enter", preventDefault() { prevented = true; } });
  await settle(); await settle();
  assert.equal(prevented, true);
  assert.deepEqual(block.calls, ["/apps/loopd2c/api/delhivery/pincode?pin=682001"]);
  block.input.fire("keydown", { key: "a", preventDefault() { throw new Error("should not prevent other keys"); } });
});

test("shoppers don't see the check when Delhivery isn't connected", async () => {
  const block = loadBlock({ responses: [[503, { ok: false, error: "DELHIVERY_NOT_CONFIGURED" }]] });
  block.input.value = "682001";
  block.button.fire("click");
  await settle(); await settle();
  assert.equal(block.root.hidden, true);
});

// Pulls the bag's delivery helpers out of the drawer script and runs them alone.
function loadDrawerDelivery(storage, now) {
  const start = drawerSource.indexOf("  var DELIVERY_PIN_KEYS");
  const end = drawerSource.indexOf("  function renderDeliveryEstimate() {");
  assert.ok(start > 0 && end > start, "drawer delivery helpers not found");
  const RealDate = Date;
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [now.getTime()])); } }
  const context = { window: { localStorage: storage }, Date: FixedDate, JSON, Number, isNaN, String };
  vm.runInNewContext(`${drawerSource.slice(start, end)}\nthis.read = readDeliveryPinResult; this.ship = deliveryShipDate;`, context);
  return context;
}

test("the bag reads the app block's result and still accepts the theme checker's", () => {
  const appResult = { pin: "682001", city: "Kochi", checkedAt: "2026-10-23T10:00:00Z" };
  const themeResult = { pin: "400001", city: "Mumbai", checkedAt: "2026-10-22T10:00:00Z" };
  assert.equal(loadDrawerDelivery(makeStorage({ megaska_delivery_pin_result: JSON.stringify(themeResult) }), new Date()).read().pin, "400001");
  assert.equal(loadDrawerDelivery(makeStorage({ loopd2c_delivery_pin_result: JSON.stringify(appResult) }), new Date()).read().pin, "682001");
  const both = makeStorage({ loopd2c_delivery_pin_result: JSON.stringify(appResult), megaska_delivery_pin_result: JSON.stringify({ ...themeResult, checkedAt: "2026-10-23T11:00:00Z" }) });
  assert.equal(loadDrawerDelivery(both, new Date()).read().pin, "400001", "most recent check wins");
  assert.equal(loadDrawerDelivery(makeStorage({ loopd2c_delivery_pin_result: "{bad" }), new Date()).read(), null);
});

test("the bag uses the block's dispatch cutoff", () => {
  const afternoon = new Date(2026, 9, 20, 14, 0);
  const drawer = loadDrawerDelivery(makeStorage(), afternoon);
  assert.equal(drawer.ship({ cutoffHour: 16 }).getDate(), 20);
  assert.equal(drawer.ship({}).getDate(), 21, "defaults to a noon cutoff");
  assert.equal(drawer.ship(null).getDate(), 21);
});
