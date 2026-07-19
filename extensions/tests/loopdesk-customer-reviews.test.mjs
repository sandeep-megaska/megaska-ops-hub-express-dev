import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const form = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.js", "utf8");
const block = readFileSync("extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid", "utf8");
const expressCheckout = readFileSync("extensions/megaska-otp/assets/megaska-express-modal.js", "utf8");

test("dashboard renders customer-safe review states and empty states", () => {
  for (const text of ["Pending moderation", "Published", "Not published", "You have not submitted any reviews yet.", "You have no delivered purchases awaiting review."]) assert.match(dashboard, new RegExp(text.replace(/[.]/g, "\\.")));
  assert.doesNotMatch(dashboard, /dangerouslySetInnerHTML/);
});

test("dashboard opens the shared form once with the dashboard entry point and refreshes on success", () => {
  assert.match(dashboard, /LoopDeskReviewForm\.open\(item, \{ entryPoint: "CUSTOMER_DASHBOARD"/);
  assert.match(dashboard, /loopdesk:review-submitted/);
  assert.match(form, /payload\.entryPoint=opt\.entryPoint\|\|"PRODUCT_PAGE"/);
  assert.match(form, /window\.LoopDeskReviewForm=Object\.assign/);
  assert.equal((block.match(/loopdesk-product-reviews\.js/g) || []).length, 1);
});


test("product review eligibility reuses the persisted LoopDesk OTP bearer token", () => {
  assert.match(form, /SESSION_KEY="megaska_session_token"/);
  assert.match(form, /localStorage\.getItem\(SESSION_KEY\)/);
  assert.match(form, /base\.Authorization="Bearer "\+t/);
  assert.match(form, /credentials:"include"/);
});


test("logged-out Write Review owns OTP continuation without resuming checkout", () => {
  assert.match(form, /pending=\{root:root,until:Date\.now\(\)\+300000\}/);
  assert.match(form, /clearPendingAction\?\.\(\);window\.MegaskaOtp\.openModal\("review-form"\)/);
  assert.match(form, /if\(pending&&e\.detail&&e\.detail\.authenticated/);
  assert.match(form, /var r=pending\.root;pending=null;loadEligible\(r\)/);
  assert.doesNotMatch(form, /MegaskaExpressCheckout|resumeCheckout|openCheckout|pendingCheckout/);
});

test("logged-in Write Review continues without OTP or checkout", () => {
  assert.match(form, /if\(s&&s\.authenticated\)return loadEligible\(root\);pending=/);
});

test("cancelled review authentication clears only the pending review", () => {
  assert.match(form, /addEventListener\("megaska:otp-cancelled",function\(\)\{pending=null\}\)/);
});

test("Express Checkout keeps its existing OTP callback continuation", () => {
  assert.match(expressCheckout, /pendingAction: \{ type: "callback", callback: \(\) => open\(\{ triggerEl \}\) \}/);
  assert.match(expressCheckout, /MegaskaOtp\?\.openModal\) window\.MegaskaOtp\.openModal\("express-checkout"\)/);
});
