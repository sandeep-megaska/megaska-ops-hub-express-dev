import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const form = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.js", "utf8");
const formStyles = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.css", "utf8");
const eligiblePurchasesRoute = readFileSync("app/api/reviews/submissions/eligible-purchases/route.ts", "utf8");
const block = readFileSync("extensions/megaska-otp/blocks/loopdesk-customer-dashboard.liquid", "utf8");

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

test("review form keeps canonical product identity separate from variant metadata", () => {
  assert.match(eligiblePurchasesRoute, /\.\.\.purchase, verifiedPurchase: true/);
  assert.doesNotMatch(eligiblePurchasesRoute, /productTitle: _productTitle/);
  assert.match(form, /p\.productTitle\|\|p\.lineItemProductTitle\|\|p\.storefrontProductTitle\|\|"Purchased product"/);
  assert.match(form, /v\.toLowerCase\(\)===\"default title\"/);
  assert.match(form, /return\"Size: \"\+v/);
  assert.match(form, /p\.verifiedPurchase===true/);
  assert.match(form, /loopdesk-review-product-image/);
});

test("review dialog owns scrolling while its header and footer remain outside the scroll body", () => {
  assert.match(form, /loopdesk-review-form-header/);
  assert.match(form, /loopdesk-review-form-body/);
  assert.match(form, /loopdesk-review-form-footer/);
  assert.match(formStyles, /max-height:min\(860px,calc\(100dvh - 32px\)\)/);
  assert.match(formStyles, /\.loopdesk-review-form-body\{min-height:0;overflow-y:auto;overscroll-behavior:contain/);
  assert.match(formStyles, /\.loopdesk-review-form-dialog\{[^}]*overflow:hidden/);
  assert.match(form, /document\.body\.style\.top=\"-\"\+scrollY\+\"px\"/);
});

test("rating remains ordered, labelled, keyboard operable, and submission is duplicate-safe", () => {
  assert.match(form, /\[1,2,3,4,5\]\.map/);
  assert.match(form, /aria-label=\"'\+n\+\(n===1\?' star':' stars'\)/);
  assert.match(form, /e\.key!==\"ArrowLeft\"&&e\.key!==\"ArrowRight\"/);
  assert.match(form, /if\(busy\)return/);
  assert.match(form, /btn\.disabled=true/);
  assert.match(form, /btn\.textContent=\"Submitting…\"/);
});

