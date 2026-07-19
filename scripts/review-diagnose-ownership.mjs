#!/usr/bin/env node
import "dotenv/config";
import { prisma } from "../services/db/prisma.ts";
import { buildReviewOwnershipTrace } from "../services/reviews/review-ownership-diagnostic.ts";
import { normalizeShopifyProductId, shopifyProductIdCandidates } from "../services/reviews/shopify-product-id.ts";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=")];
}));
const required = ["shop-id", "customer-profile-id", "product-id"];
if (required.some((key) => !args[key])) {
  console.error("Usage: npm run review:diagnose-ownership -- --shop-id=<id> --customer-profile-id=<id> --product-id=<id-or-gid> [--review-request-id=<id>] [--order-id=<id>]");
  process.exitCode = 2;
} else {
  const productId = normalizeShopifyProductId(args["product-id"]);
  if (!productId) {
    console.error("Invalid Shopify product ID");
    process.exitCode = 2;
  } else {
    // Every read is constrained by the operator-supplied tenant. This command
    // contains no create/update/delete/upsert operation.
    const reviewRequest = await prisma.reviewRequest.findFirst({
      where: {
        shopId: args["shop-id"],
        shopifyProductId: { in: shopifyProductIdCandidates(productId) },
        ...(args["review-request-id"] ? { id: args["review-request-id"] } : {}),
        ...(args["order-id"] ? { megaskaOrderId: args["order-id"] } : {}),
      },
      orderBy: [{ deliveredAtSnapshot: "desc" }, { createdAt: "desc" }],
      include: { megaskaOrder: { select: { id: true, shopId: true, customerProfileId: true } } },
    });
    const ownership = await buildReviewOwnershipTrace({
      shopId: args["shop-id"],
      authenticatedCustomerProfileId: args["customer-profile-id"],
      reviewRequest,
      order: reviewRequest?.megaskaOrder ?? null,
    }, prisma);
    const pass = (value) => value ? "PASS" : "FAIL";
    console.log("Review ownership diagnostic");
    console.log(`\nAuthenticated profile:\n${ownership.authenticatedCustomerProfileId ?? "MISSING"}`);
    console.log(`\nCanonical authenticated profile:\n${ownership.canonicalCustomerProfileId ?? "MISSING"}`);
    console.log(`\nReviewRequest:\nid: ${ownership.reviewRequestId ?? "NOT FOUND"}\nraw owner: ${ownership.reviewRequestCustomerProfileId ?? "MISSING"}\ncanonical owner: ${ownership.canonicalReviewRequestCustomerProfileId ?? "MISSING"}\ntenant match: ${pass(ownership.reviewRequestTenantMatch)}`);
    console.log(`\nMegaskaOrder:\nid: ${ownership.orderId ?? "NOT FOUND"}\nraw owner: ${ownership.orderCustomerProfileId ?? "MISSING"}\ncanonical owner: ${ownership.canonicalOrderCustomerProfileId ?? "MISSING"}\ntenant match: ${pass(ownership.orderTenantMatch)}`);
    console.log(`\nComparisons:\nsession ↔ review request (raw gate): ${ownership.reviewRequestToCanonical}\nsession ↔ review request (canonical): ${ownership.canonicalReviewRequestToSession}\nsession ↔ order (raw gate): ${ownership.orderToCanonical}\nsession ↔ order (canonical): ${ownership.canonicalOrderToSession}\nreview request ↔ order (raw gate): ${ownership.reviewRequestToOrder}\nreview request ↔ order (canonical): ${ownership.canonicalReviewRequestToOrder}`);
    console.log(`\nMerge lookup attempted: ${ownership.mergeLookupAttempted ? "YES" : "NO"}\nMerge detected: ${ownership.mergeDetected ? "YES" : "NO"}\nMerge loop detected: ${ownership.mergeLoopDetected ? "YES" : "NO"}`);
    console.log(`\nResult:\n${ownership.failingPredicate ? "CUSTOMER_OWNERSHIP_MISMATCH" : "OWNERSHIP_PREDICATES_PASS"}`);
    console.log(`\nFailing predicate:\n${ownership.failingPredicate ?? "NONE"}`);
  }
}
await prisma.$disconnect();
