import { prisma } from "../db/prisma.ts";

export type CanonicalDeliverySource = "SHOPIFY_FULFILLMENT" | "COURIER_SHIPMENT" | "INTERNAL_STATUS" | "MANUAL" | "MIGRATED";
export type RecordCanonicalDeliveryInput = { shopId: string; megaskaOrderId: string; deliveredAt: Date | string; source: CanonicalDeliverySource };
type Order = { id:string; shopId:string; orderPlacedAt:Date|null; deliveredAt:Date|null; deliverySource:CanonicalDeliverySource|null; status:string };
type DeliveryDb = { megaskaOrder: { findFirst(a: unknown): Promise<Order|null>; update(a: unknown): Promise<Order> } };
const authority: Record<CanonicalDeliverySource, number>={SHOPIFY_FULFILLMENT:5,COURIER_SHIPMENT:4,MANUAL:3,INTERNAL_STATUS:2,MIGRATED:1};
const futureSkewMs=24*60*60*1000;
export function chooseCanonicalDeliveryTimestamp(existing: Pick<Order,"deliveredAt"|"deliverySource">, candidate:Date, source:CanonicalDeliverySource) {
 if (!existing.deliveredAt) return { deliveredAt:candidate, source };
 if (candidate.getTime()<existing.deliveredAt.getTime()) return { deliveredAt:candidate, source };
 if (existing.deliverySource==="MIGRATED" && authority[source]>authority.MIGRATED) return { deliveredAt:candidate, source };
 return { deliveredAt:existing.deliveredAt, source:existing.deliverySource! };
}

export function isOrderDeliveredForReview(order: { deliveredAt: Date | null; status: string }) {
 return Boolean(order.deliveredAt) && order.status === "DELIVERED";
}

export async function recordCanonicalOrderDelivery(input:RecordCanonicalDeliveryInput, db:DeliveryDb=prisma as unknown as DeliveryDb) {
 const candidate=input.deliveredAt instanceof Date ? new Date(input.deliveredAt) : new Date(input.deliveredAt);
 if (Number.isNaN(candidate.getTime())) throw new Error("Invalid deliveredAt timestamp");
 if (typeof input.deliveredAt==="string" && !/(Z|[+-]\d\d:\d\d)$/.test(input.deliveredAt)) throw new Error("deliveredAt must include an explicit UTC offset");
 if (candidate.getTime()>Date.now()+futureSkewMs) throw new Error("deliveredAt is unreasonably in the future");
 const order=await db.megaskaOrder.findFirst({where:{id:input.megaskaOrderId,shopId:input.shopId}}); if(!order) throw new Error("Order not found for shop");
 if(order.orderPlacedAt && candidate.getTime()<order.orderPlacedAt.getTime()) throw new Error("deliveredAt precedes order creation");
 const selected=chooseCanonicalDeliveryTimestamp(order,candidate,input.source); const changed=!order.deliveredAt || selected.deliveredAt.getTime()!==order.deliveredAt.getTime() || selected.source!==order.deliverySource;
 const terminal=["CANCELLED","REFUNDED"].includes(order.status); const data={deliveredAt:selected.deliveredAt,deliverySource:selected.source,...(!terminal?{status:"DELIVERED" as const}: {})};
 const result=changed||(!terminal&&order.status!=="DELIVERED") ? await db.megaskaOrder.update({where:{id:order.id},data}) : order;
 console.info({operation:"recordCanonicalOrderDelivery",shopId:input.shopId,megaskaOrderId:input.megaskaOrderId,source:input.source,previousDeliveredAt:order.deliveredAt?.toISOString()??null,candidateDeliveredAt:candidate.toISOString(),selectedDeliveredAt:selected.deliveredAt.toISOString(),changed});
 return result;
}
