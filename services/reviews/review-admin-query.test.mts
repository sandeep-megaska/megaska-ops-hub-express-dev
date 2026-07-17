import assert from "node:assert/strict";
import test from "node:test";
import { listAdminReviews } from "./review-admin-query.ts";
test("admin review list scopes filters and search to the tenant",async()=>{const calls:unknown[]=[];const db={productReview:{findMany:async(args:unknown)=>{calls.push(args);return[]},count:async(args:unknown)=>{calls.push(args);return 0},findFirst:async()=>null}};const result=await listAdminReviews({shopId:"shop-a",status:"PENDING_MODERATION",search:"Order #42",db});assert.equal(result.total,0);const text=JSON.stringify(calls);assert.match(text,/shop-a/);assert.match(text,/PENDING_MODERATION/);assert.match(text,/Order #42/)});
