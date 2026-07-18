import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync("extensions/megaska-otp/assets/loopdesk-customer-dashboard.js", "utf8");
const form = readFileSync("extensions/megaska-otp/assets/loopdesk-product-reviews.js", "utf8");
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
