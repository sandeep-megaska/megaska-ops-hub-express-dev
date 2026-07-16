import test from "node:test"; import assert from "node:assert/strict"; import { createVerifiedPurchaseReview } from "./review-foundation.ts";
test("review rating validation precedes persistence",async()=>{await assert.rejects(()=>createVerifiedPurchaseReview({shopId:"s",customerProfileId:"c",reviewRequestId:"r",rating:6,customerDisplayName:"A"},{}) ,/rating/);});
