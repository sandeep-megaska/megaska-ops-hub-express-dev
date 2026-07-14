import assert from "node:assert/strict";
import test from "node:test";
import { buildDashboardExchangeProgress, loadDashboardOrderRequests, resetDashboardRequestDependenciesForTest, setDashboardRequestDependenciesForTest } from "./requests.ts";
const context={shopId:"shop-1",shopDomain:"s",customerProfileId:"cust-1",sessionId:"sess",now:new Date()};
test.afterEach(()=>resetDashboardRequestDependenciesForTest());
test("Empty order-number input performs no queries",async()=>{let calls=0;setDashboardRequestDependenciesForTest({orderActionRequest:{findMany:async()=>{calls++;return[]}},refundRequest:{findMany:async()=>{calls++;return[]}}});const r=await loadDashboardOrderRequests({context,orderNumbers:[]});assert.equal(calls,0);assert.equal(r.openRequestCount,0);});
test("Batch queries trim/dedupe and scope by shop/customer/order",async()=>{const queries: any[]=[];setDashboardRequestDependenciesForTest({orderActionRequest:{findMany:async(a:any)=>{queries.push(a);return[]}},refundRequest:{findMany:async()=>[]}});await loadDashboardOrderRequests({context,orderNumbers:[" 1001 ","#1001"]});assert.equal(queries.length,3);for(const q of queries){assert.equal(q.where.shopId,"shop-1");assert.equal(q.where.customerProfileId,"cust-1");assert.deepEqual(q.where.orderNumber.in,["#1001"]);}});
test("Latest requests, refunds, mappings, conflicts and open count",async()=>{
 const d=(s:string)=>new Date(s); let refundCalls=0;
 const cancellations=[{id:"old",orderNumber:"#1",status:"REJECTED",requestedAt:d("2026-01-01"),updatedAt:null,orderAmountSnapshot:"100"},{id:"can",orderNumber:"#1",status:"APPROVED",requestedAt:d("2026-01-02"),updatedAt:null,orderAmountSnapshot:"100"},{id:"can2",orderNumber:"#2",status:"CLOSED",requestedAt:d("2026-01-02"),updatedAt:null,orderAmountSnapshot:"0"}].sort((a,b)=>b.requestedAt.getTime()-a.requestedAt.getTime());
 const exchanges=[{id:"ex",orderNumber:"#1",status:"PICKUP_SCHEDULED",requestedAt:d("2026-01-03"),updatedAt:null,payments:[{status:"PAID",paidAt:d("2026-01-03"),amount:9900,currency:"INR"}],shipments:[{id:"rs",direction:"REVERSE_PICKUP",status:"SCHEDULED",carrier:"D",awb:"R",trackingUrl:null,pickupAt:null,shippedAt:null,deliveredAt:null,updatedAt:d("2026-01-03")},{id:"fs",direction:"FORWARD_REPLACEMENT",status:"NOT_STARTED",carrier:null,awb:"F",trackingUrl:null,pickupAt:null,shippedAt:null,deliveredAt:null,updatedAt:d("2026-01-03")}]}];
 const issues=[{id:"iss",orderNumber:"#2",status:"OPEN",requestedAt:d("2026-01-03"),updatedAt:null},{id:"closed",orderNumber:"#3",status:"CLOSED",requestedAt:d("2026-01-03"),updatedAt:null}];
 setDashboardRequestDependenciesForTest({orderActionRequest:{findMany:async(a:any)=>a.where.requestType==="CANCELLATION"?cancellations:a.where.requestType==="EXCHANGE"?exchanges:issues},refundRequest:{findMany:async(a:any)=>{refundCalls++;assert.equal(a.where.shopId,"shop-1");assert.equal(a.where.orderActionRequest.shopId,"shop-1");return[{id:"ref",status:"PAID",method:"PREPAID",amount:100,currency:"INR",orderActionRequestId:"can",walletTransactionId:null,createdAt:d("2026-01-02"),updatedAt:d("2026-01-03")}];}}});
 const r=await loadDashboardOrderRequests({context,orderNumbers:["1","2","3"]});
 assert.equal(refundCalls,1);assert.equal(r.byOrderNumber.get("#1")?.cancellation?.id,"can");assert.equal(r.byOrderNumber.get("#1")?.cancellation?.refundOutcome.refundStatusCode,"PAID");assert.equal(r.byOrderNumber.get("#1")?.exchange?.payment?.amountPaise,9900);assert.equal(r.byOrderNumber.get("#1")?.exchange?.reverseShipment?.awb,"R");assert.equal(r.byOrderNumber.get("#1")?.exchange?.replacementShipment?.awb,"F");assert.equal(r.byOrderNumber.get("#1")?.exchange?.progress.length,7);assert.equal(r.byOrderNumber.get("#2")?.issue?.id,"iss");assert.deepEqual(r.byOrderNumber.get("#1")?.timeline.map((x)=>x.requestType),["EXCHANGE","CANCELLATION","CANCELLATION"]);assert.equal(r.byOrderNumber.get("#1")?.timeline[0].statusLabel,"Processing");assert.equal(r.byOrderNumber.get("#1")?.activeConflict?.requestType,"CANCELLATION");assert.equal(r.openRequestCount,4);
});
test("Exchange progress contains all seven ordered steps",()=>{assert.deepEqual(buildDashboardExchangeProgress({id:"e",status:"CLOSED",requestedAt:new Date()}).map(s=>s.key),["REQUESTED","FEE_PAID","PICKUP_SCHEDULED","PICKED_UP","ITEM_RECEIVED","REPLACEMENT_SHIPPED","COMPLETED"]);});

test("Refund settlement snapshots require authoritative Store Credit transaction linkage",async()=>{
 const d=(s:string)=>new Date(s); let walletQuery:any;
 const cancellations=[{id:"can",orderNumber:"#1",status:"APPROVED",requestedAt:d("2026-01-01"),updatedAt:null,orderAmountSnapshot:"100"}];
 const badTx=(over:any)=>({id:over.id||"tx",shopId:"shop-1",customerProfileId:"cust-1",direction:"CREDIT",transactionType:"COD_REFUND_CREDIT",amount:100,currency:"INR",sourceType:"REFUND_REQUEST",sourceId:over.sourceId||over.refundId,createdAt:d("2026-01-03"),...over});
 const refunds=[
  {id:"ref-ok",status:"PAID",method:"COD",amount:100,currency:"INR",orderActionRequestId:"can",walletTransactionId:"tx-ok",paidAt:d("2026-01-03"),createdAt:d("2026-01-02"),updatedAt:d("2026-01-03")},
  {id:"ref-wrong-shop",status:"PAID",method:"COD",amount:100,currency:"INR",orderActionRequestId:"can",walletTransactionId:"tx-wrong-shop",paidAt:d("2026-01-03"),createdAt:d("2026-01-02"),updatedAt:d("2026-01-03")},
  {id:"ref-debit",status:"PAID",method:"COD",amount:100,currency:"INR",orderActionRequestId:"can",walletTransactionId:"tx-debit",paidAt:d("2026-01-03"),createdAt:d("2026-01-02"),updatedAt:d("2026-01-03")},
  {id:"ref-zero",status:"PAID",method:"COD",amount:100,currency:"INR",orderActionRequestId:"can",walletTransactionId:"tx-zero",paidAt:d("2026-01-03"),createdAt:d("2026-01-02"),updatedAt:d("2026-01-03")}
 ];
 const txs=[badTx({id:"tx-ok",refundId:"ref-ok",sourceId:"ref-ok"}),badTx({id:"tx-wrong-shop",refundId:"ref-wrong-shop",sourceId:"ref-wrong-shop",shopId:"other"}),badTx({id:"tx-debit",refundId:"ref-debit",sourceId:"ref-debit",direction:"DEBIT"}),badTx({id:"tx-zero",refundId:"ref-zero",sourceId:"ref-zero",amount:0})];
 setDashboardRequestDependenciesForTest({orderActionRequest:{findMany:async(a:any)=>a.where.requestType==="CANCELLATION"?cancellations:[]},refundRequest:{findMany:async()=>refunds},walletTransaction:{findMany:async(a:any)=>{walletQuery=a; return txs;}}});
 const r=await loadDashboardOrderRequests({context,orderNumbers:["1"]});
 assert.equal(walletQuery.where.shopId,"shop-1");
 assert.equal(walletQuery.where.customerProfileId,"cust-1");
 const events=r.byOrderNumber.get("#1")?.timeline[0].events.filter((e)=>e.type==="STORE_CREDIT_ISSUED")||[];
 assert.equal(events.length,1);
 assert.deepEqual(events[0].amount,{amountPaise:100,currency:"INR"});
 assert.ok(!JSON.stringify(r.byOrderNumber.get("#1")?.timeline).includes("walletTransactionId"));
});
