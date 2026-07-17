import assert from "node:assert/strict";
import test from "node:test";
import { reviewEmptyState, reviewStatusBadgeTone, reviewStatusLabel } from "./review-admin-ui.ts";
test("review admin UI helpers distinguish filters, search, and accessible statuses",()=>{assert.equal(reviewStatusLabel("PENDING_MODERATION"),"Pending moderation");assert.equal(reviewStatusBadgeTone("PUBLISHED"),"success");assert.equal(reviewStatusBadgeTone("REJECTED"),"danger");assert.equal(reviewEmptyState("chair","ALL").title,"No reviews match your search");assert.equal(reviewEmptyState("","PUBLISHED").title,"No reviews match this status");assert.equal(reviewEmptyState("","ALL").title,"No reviews yet");});
