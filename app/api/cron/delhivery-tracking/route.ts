import { NextRequest, NextResponse } from "next/server";
import type { ExchangeRequestStatus, ShipmentStatus } from "../../../../generated/prisma";
import { prisma } from "../../../../services/db/prisma";
import { syncExchangeShipment } from "../../../../services/exchange/tracking-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many exchange requests to sync per run. Each may have up to two Delhivery
// shipments (reverse + forward), each an external tracking call, so this bounds
// the run well under maxDuration. Anything not reached this run is picked up on
// the next tick (we order by least-recently-updated).
const REQUEST_LIMIT = 25;

// Terminal states we never need to re-poll.
const TERMINAL_REQUEST_STATUSES: ExchangeRequestStatus[] = ["REJECTED", "CLOSED"];
const TERMINAL_SHIPMENT_STATUSES: ShipmentStatus[] = ["DELIVERED", "FAILED"];

// Vercel Cron invokes this on a schedule (see vercel.json) and sends
// `Authorization: Bearer <CRON_SECRET>`. Fail closed when CRON_SECRET is unset so
// the endpoint is never open. (Same pattern as /api/cron/checkout-recovery.)
function isAuthorizedCron(req: NextRequest): boolean {
  const secret = String(process.env.CRON_SECRET || "").trim();
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isSyncableShipment(shipment: { carrier: string | null; awb: string | null; status: ShipmentStatus }) {
  return (
    shipment.carrier === "DELHIVERY" &&
    Boolean(shipment.awb) &&
    !TERMINAL_SHIPMENT_STATUSES.includes(shipment.status)
  );
}

async function run(req: NextRequest) {
  if (!isAuthorizedCron(req)) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  console.info("[DELHIVERY TRACKING] cron_started");

  const requests = await prisma.orderActionRequest.findMany({
    where: {
      requestType: "EXCHANGE",
      status: { notIn: TERMINAL_REQUEST_STATUSES },
      shipments: {
        some: {
          carrier: "DELHIVERY",
          awb: { not: null },
          status: { notIn: TERMINAL_SHIPMENT_STATUSES },
        },
      },
    },
    include: { shipments: true },
    orderBy: { updatedAt: "asc" },
    take: REQUEST_LIMIT,
  });

  let shipmentsSynced = 0;
  let statusAdvanced = 0;
  let shipmentsFailed = 0;

  for (const request of requests) {
    // Track the request status in-memory so a second shipment on the same
    // request sees the status a prior shipment just advanced it to.
    let currentStatus: string = request.status;
    const syncable = request.shipments.filter(isSyncableShipment);
    for (const shipment of syncable) {
      try {
        const result = await syncExchangeShipment(
          { id: request.id, status: currentStatus, shopId: request.shopId },
          shipment,
          { actorType: "system" },
        );
        currentStatus = result.nextExchangeStatus;
        shipmentsSynced += 1;
        if (result.changed) statusAdvanced += 1;
      } catch (error) {
        shipmentsFailed += 1;
        console.warn("[DELHIVERY TRACKING] shipment_sync_failed", {
          requestId: request.id,
          shipmentId: shipment.id,
          awb: shipment.awb,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const truncated = requests.length === REQUEST_LIMIT;
  const summary = {
    requestsScanned: requests.length,
    shipmentsSynced,
    statusAdvanced,
    shipmentsFailed,
    truncated,
  };
  console.info("[DELHIVERY TRACKING] cron_completed", summary);
  if (truncated) {
    console.info("[DELHIVERY TRACKING] hit REQUEST_LIMIT; remaining requests sync on the next tick", {
      limit: REQUEST_LIMIT,
    });
  }

  return NextResponse.json({ ok: true, ...summary }, { headers: { "Cache-Control": "no-store" } });
}

export const GET = run;
export const POST = run;
