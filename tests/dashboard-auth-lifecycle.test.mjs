import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

function createEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { const list = listeners.get(type) || []; list.push(fn); listeners.set(type, list); },
    dispatchEvent(event) { for (const fn of listeners.get(event.type) || []) fn(event); return true; },
  };
}

async function setup({ token = '', fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ customer: { name: 'A' }, orders: [] }) }) } = {}) {
  const events = createEventTarget();
  const store = new Map(token ? [['megaska_session_token', token]] : []);
  const root = { dataset: {}, attrs: {}, innerHTML: '', setAttribute(k, v) { this.attrs[k] = v; }, querySelector() { return { addEventListener() {}, textContent: '' }; } };
  const logs = [];
  const context = {
    console: { info: (...args) => logs.push(args), warn() {}, error() {}, log() {} },
    setTimeout, clearTimeout, Promise, AbortController,
    window: { location: { origin: 'https://shop.test', pathname: '/apps/megaska/dashboard' }, Shopify: { shop: 'shop.test' }, MegaskaAuth: { getSessionToken: () => store.get('megaska_session_token') || '', openLogin() {} } },
    document: Object.assign(events, { readyState: 'complete', documentElement: { getAttribute: () => 'shop.test' }, getElementById: (id) => id === 'loopdesk-customer-dashboard-root' ? root : null, querySelector: () => null, querySelectorAll: () => [] }),
    localStorage: { getItem: (k) => store.get(k) || '', setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    fetch: fetchImpl,
    CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    URL,
    Intl,
  };
  context.window.window = context.window;
  context.window.document = context.document;
  context.window.localStorage = context.localStorage;
  context.window.console = context.console;
  vm.createContext(context);
  vm.runInContext(await readFile('extensions/megaska-otp/assets/loopdesk-customer-dashboard.js', 'utf8'), context);
  return { context, root, store, logs };
}

const noToken = await setup();
assert.equal(noToken.root.dataset.status, 'AUTH_REQUIRED');

let calls = 0;
const falseEvent = await setup({ fetchImpl: async () => { calls += 1; throw new Error('should not fetch'); } });
falseEvent.context.document.dispatchEvent(new falseEvent.context.CustomEvent('megaska:auth-state-changed', { detail: { authenticated: false } }));
assert.equal(calls, 0);
assert.equal(falseEvent.root.dataset.status, 'AUTH_REQUIRED');

calls = 0;
const trueEvent = await setup({ fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ customer: { name: 'A' }, orders: [] }) }; } });
trueEvent.store.set('megaska_session_token', 'token');
trueEvent.context.document.dispatchEvent(new trueEvent.context.CustomEvent('megaska:auth-state-changed', { detail: { authenticated: true } }));
trueEvent.context.document.dispatchEvent(new trueEvent.context.CustomEvent('megaska:auth-state-changed', { detail: { authenticated: true } }));
await new Promise((r) => setTimeout(r, 20));
assert.equal(calls, 1);

calls = 0;
const delayed = await setup({ fetchImpl: async () => { calls += 1; return { ok: true, status: 200, json: async () => ({ customer: { name: 'B' }, orders: [] }) }; } });
delayed.context.document.dispatchEvent(new delayed.context.CustomEvent('megaska:auth-state-changed', { detail: { authenticated: true } }));
assert.equal(delayed.root.dataset.status, 'AUTH_SETTLING');
setTimeout(() => delayed.store.set('megaska_session_token', 'later'), 120);
await new Promise((r) => setTimeout(r, 250));
assert.equal(calls, 1);
assert.match(delayed.root.innerHTML, /My Account|No email added/);

calls = 0;
const never = await setup({ fetchImpl: async () => { calls += 1; throw new Error('should not fetch'); } });
never.context.document.dispatchEvent(new never.context.CustomEvent('megaska:auth-state-changed', { detail: { authenticated: true } }));
await new Promise((r) => setTimeout(r, 1100));
assert.equal(calls, 0);
assert.equal(never.root.dataset.status, 'AUTH_REQUIRED');

calls = 0;
const unauthorized = await setup({ token: 'bad', fetchImpl: async () => { calls += 1; return { ok: false, status: 401, json: async () => ({}) }; } });
await new Promise((r) => setTimeout(r, 20));
assert.equal(calls, 1);
assert.equal(unauthorized.root.dataset.status, 'AUTH_REQUIRED');
await new Promise((r) => setTimeout(r, 20));
assert.equal(calls, 1);

const logText = trueEvent.logs.flat().map(String).join(' ');
assert(!logText.includes('token'));
console.log('dashboard auth lifecycle tests passed');
