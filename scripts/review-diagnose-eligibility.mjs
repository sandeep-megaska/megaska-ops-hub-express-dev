#!/usr/bin/env node
import "dotenv/config";
import { prisma } from "../services/db/prisma.ts";
import { resolveReviewEligibility } from "../services/reviews/review-eligible-purchases.ts";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
if (!args["shop-id"] || !args["customer-profile-id"] || !args["product-id"]) {
  console.error("Usage: npm run review:diagnose-eligibility -- --shop-id=<id> --customer-profile-id=<id> --product-id=<id-or-gid>");
  process.exitCode = 2;
} else {
  const result = await resolveReviewEligibility({ shopId: args["shop-id"], customerProfileId: args["customer-profile-id"], productId: args["product-id"], requestSource: "DIAGNOSTIC_CLI" });
  const context = result.diagnostics.diagnosticContext;
  console.log("Review eligibility diagnostic");
  console.log(`Canonical customer: ${context.identityMergeDetected ? "merged profile resolved" : context.canonicalCustomerProfileId ? "matched" : "not found"}`);
  console.log(`Product normalization: ${context.normalizedProductId ? "matched" : "failed"}`);
  console.log(`Matching purchased lines: ${context.reviewRequestCountAfterCustomerProfileFilter}`);
  console.log(`Delivered matching order: ${context.deliveredOrderFound ? "found" : "not found"}`);
  console.log(`Review request: ${context.reviewRequestFound ? "found" : "not found"}`);
  console.log(`Existing review: ${context.existingReviewFound ? "found" : "not found"}`);
  console.log(`\nResult:\n${result.diagnostics.code}`);
  console.log(`\nForm behavior:\n${result.diagnostics.eligible && context.existingReviewFound ? "ALREADY_REVIEWED" : result.diagnostics.eligible ? "OPEN" : "BLOCKED"}`);
}
await prisma.$disconnect();
