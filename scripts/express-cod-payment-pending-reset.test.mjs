import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync("app/api/express/checkout/intents/[id]/payment-method/route.ts", "utf8");
const resolverSource = readFileSync("services/cod-advance/resolver.ts", "utf8");
const modalSource = readFileSync("extensions/megaska-otp/assets/loopd2c-express-modal.js", "utf8");

function bodyOf(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${signature} must exist`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") depth -= 1;
    if (depth === 0) return source.slice(brace + 1, i);
  }
  throw new Error(`Could not parse ${signature}`);
}

// --- The bug: a background prepaid warm-up advances the intent to
// PAYMENT_PENDING; the COD-policy resolver rejects that status, so switching to
// COD left the "Place COD Order" button disabled with "Intent cannot be used
// for COD policy". These lock the server + client contract that fixes it.

test("COD-policy resolver rejects PAYMENT_PENDING but accepts PAYMENT_SELECTED", () => {
  // The allow-list is the reason the reset below is required: PAYMENT_PENDING is
  // deliberately NOT selectable for COD, so the route must reset it first.
  assert.doesNotMatch(resolverSource, /allowedCheckoutStatuses[\s\S]*?"PAYMENT_PENDING"[\s\S]*?\]\)/, "PAYMENT_PENDING must not be a COD-selectable status");
  assert.match(resolverSource, /allowedCheckoutStatuses[\s\S]*?"PAYMENT_SELECTED"/, "PAYMENT_SELECTED must remain a COD-selectable status");
  assert.match(resolverSource, /Intent cannot be used for COD policy/, "the guarded error message must remain");
});

test("payment-method route resets an abandoned PAYMENT_PENDING intent to PAYMENT_SELECTED on method switch", () => {
  assert.match(routeSource, /isAbandonedPaymentPending\s*=\s*latestIntent\.status === PAYMENT_METHOD_PAYMENT_PENDING_STATUS/, "must detect an abandoned PAYMENT_PENDING intent");
  assert.match(routeSource, /forcePaymentSelected\s*=\s*isUnsupportedDiscountAppliedStatus \|\| isAbandonedPaymentPending/, "PAYMENT_PENDING must join DISCOUNT_APPLIED in forcing PAYMENT_SELECTED");
  assert.match(routeSource, /forcePaymentSelected \? \{ status: "PAYMENT_SELECTED" as const \} : \{\}/, "the forced write must set status PAYMENT_SELECTED");
});

test("payment-method route only resets PAYMENT_PENDING when no CONFIRMED payment exists", () => {
  // The confirmed-payment guard must run before we treat PAYMENT_PENDING as abandoned.
  const confirmedGuard = routeSource.indexOf('confirmedPaymentCount > 0');
  const abandonedDetect = routeSource.indexOf('isAbandonedPaymentPending');
  assert.ok(confirmedGuard !== -1, "must guard on confirmed payments");
  assert.ok(abandonedDetect > confirmedGuard, "abandoned-pending reset must come after the confirmed-payment guard");
});

test("payment-method route clears every pending payment when resetting an abandoned PAYMENT_PENDING intent", () => {
  assert.match(routeSource, /isAbandonedPaymentPending\s*\?\s*\{ shopId: shop\.shopId, intentId, status: "PENDING"/, "must delete all pending payments (any method) on reset so no stale prepaid attempt lingers");
});

test("modal: an explicit COD tap locks out the prepaid warm-up", () => {
  const body = bodyOf(modalSource, "function setSelectedDisplayPaymentMethod");
  assert.match(body, /state\.codLocked = true/, "COD selection must set codLocked");
  assert.match(body, /state\.codLocked = false/, "non-COD selection must clear codLocked");
  // On COD the queued warm-up promise/keys must be cleared so a completed warm-up cannot be reused.
  assert.match(body, /state\.prepaidWarmupPromise = null/, "COD selection must drop any queued warm-up promise");
});

test("modal: the prepaid warm-up bails whenever COD is locked", () => {
  const body = bodyOf(modalSource, "function warmupPrepaidPayment");
  assert.match(body, /method === "COD" \|\| state\.codLocked/, "warm-up must not start once COD is locked");
  // and must re-check after its awaits, so an in-flight warm-up cannot land after the COD tap
  assert.ok((body.match(/if \(state\.codLocked\) return;/g) || []).length >= 2, "warm-up must re-check codLocked after awaits");
});

test("modal: ensureBackendPaymentMethod refuses to re-select PREPAID while COD is locked", () => {
  const body = bodyOf(modalSource, "function ensureBackendPaymentMethod");
  assert.match(body, /method === "PREPAID" && state\.codLocked/, "a late warm-up POST must be refused once COD is locked");
});

// The sticky footer total and order-summary totals live outside the payment
// section, so a method switch (which only re-renders the payment section) left
// the footer showing the prepaid-discounted total under a COD selection.

test("modal: totals block and footer total have refreshable hooks", () => {
  assert.match(modalSource, /class="megaska-express-totals" data-express-totals/, "totals block must be addressable for in-place refresh");
  assert.match(modalSource, /data-express-footer-total>\$\{footerAmountsMarkup\(\)\}/, "sticky footer must be addressable and rendered from footerAmountsMarkup()");
});

test("modal: a payment-section render also refreshes the method-dependent totals", () => {
  const body = bodyOf(modalSource, "function renderPaymentSectionOnly");
  assert.match(body, /renderTotalsOnly\(\)/, "payment-section render must refresh the footer/summary totals so they follow the selected method");
});

test("modal: totals refresh re-renders both the summary and the footer amounts", () => {
  const body = bodyOf(modalSource, "function renderTotalsOnly");
  assert.match(body, /totals\.innerHTML = totalsMarkup\(\)/, "summary totals must be re-rendered from totalsMarkup()");
  assert.match(body, /footerTotal\.innerHTML = footerAmountsMarkup\(\)/, "footer must be re-rendered from footerAmountsMarkup()");
});

test("modal: footer shows both prepaid and COD payables, collapsing to one when equal or COD unavailable", () => {
  const body = bodyOf(modalSource, "function footerAmountsMarkup");
  assert.match(body, /payableAmount\("PREPAID"\)/, "must compute the prepaid payable");
  assert.match(body, /payableAmount\("COD"\)/, "must compute the COD payable");
  assert.match(body, /prepaidPaise === codPaise/, "must collapse to a single figure when the two methods cost the same");
  assert.match(body, /isCodUnavailable/, "must collapse to prepaid-only when COD is unavailable");
  assert.match(body, /is-active/, "must highlight the currently selected method");
});
