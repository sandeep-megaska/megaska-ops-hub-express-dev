import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDelhiveryRawStatus, normalizeDelhiveryTrackingResponse } from "./delhivery-tracking-normalize.ts";

// Shapes as Delhivery returns them (ShipmentData[0].Shipment with a nested Status).
function response(status: Record<string, unknown>, scans: Array<Record<string, unknown>> = []) {
  return { ShipmentData: [{ Shipment: { AWB: "17049210018045", Status: status, Scans: scans.map((ScanDetail) => ({ ScanDetail })) } }] };
}

test("the nested current status is read (it used to come back empty)", () => {
  const snap = normalizeDelhiveryTrackingResponse(
    response({ Status: "Delivered", StatusType: "DL", StatusDateTime: "2026-10-29T13:08:57.002", Instructions: "Delivered to consignee" }, [
      { Scan: "Manifested", ScanType: "UD", ScanDateTime: "2026-10-23T23:15:06.525" },
      { Scan: "Delivered", ScanType: "DL", ScanDateTime: "2026-10-29T13:08:57.002" },
    ]),
    "17049210018045",
  );
  assert.equal(snap.rawStatus, "Delivered");
  assert.equal(snap.normalizedStatus, "DELIVERED");
  assert.equal(snap.statusUpdatedAt?.toISOString().slice(0, 10), "2026-10-29");
  assert.equal(snap.events.length, 2);
  assert.equal(snap.events[0].normalizedStatus, "READY_FOR_PICKUP");
});

test("Delhivery status types map to the right state", () => {
  const cases: Array<[string, string, string]> = [
    ["DTO", "DL", "DELIVERED"], // a return pickup delivered back to the warehouse
    ["RTO", "DL", "RTO_DELIVERED"],
    ["In Transit", "RT", "RTO_INITIATED"],
    ["In Transit", "PU", "PICKED_UP"],
    ["Scheduled", "PP", "READY_FOR_PICKUP"],
    ["Open", "PP", "READY_FOR_PICKUP"],
    ["Not Picked", "UD", "READY_FOR_PICKUP"], // not "picked up"
    ["Manifested", "UD", "READY_FOR_PICKUP"],
    ["In Transit", "UD", "IN_TRANSIT"],
    ["Dispatched", "UD", "OUT_FOR_DELIVERY"],
    ["Pending", "UD", "PROCESSING"],
    ["Canceled", "CN", "CANCELLED"],
  ];
  for (const [status, type, expected] of cases) assert.equal(normalizeDelhiveryRawStatus(status, type), expected, `${status}/${type}`);
  assert.equal(normalizeDelhiveryRawStatus(null), "PROCESSING");
  assert.equal(normalizeDelhiveryRawStatus("Not Picked"), "READY_FOR_PICKUP");
});

test("without a nested status the latest scan is used", () => {
  const snap = normalizeDelhiveryTrackingResponse({ ShipmentData: [{ Shipment: { AWB: "1", Scans: [{ ScanDetail: { Scan: "Manifested", ScanType: "UD", ScanDateTime: "2026-11-01T10:00:00" } }, { ScanDetail: { Scan: "In Transit", ScanType: "UD", ScanDateTime: "2026-11-02T10:00:00" } }] } }] }, "1");
  assert.equal(snap.normalizedStatus, "IN_TRANSIT");
  assert.equal(snap.rawStatus, "In Transit");
});
