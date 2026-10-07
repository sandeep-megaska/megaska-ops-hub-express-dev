import assert from "node:assert/strict";
import test from "node:test";
import { recordOtpDeliveryStatuses } from "./otp-delivery.ts";

function fakeDb(rows: Array<{ id: string; providerSid: string; metadata: Record<string, unknown> }>) {
  return {
    rows,
    oTPChallenge: {
      async findFirst(args: Record<string, unknown>) {
        const where = args.where as { providerSid: string };
        return rows.find((row) => row.providerSid === where.providerSid) ?? null;
      },
      async update(args: Record<string, unknown>) {
        const row = rows.find((r) => r.id === (args.where as { id: string }).id)!;
        row.metadata = (args.data as { metadata: Record<string, unknown> }).metadata;
      },
    },
  };
}

test("failed OTP delivery is saved on the challenge with Meta's reason, keeping existing metadata", async () => {
  const db = fakeDb([{ id: "c1", providerSid: "wamid.1", metadata: { mode: "whatsapp", codeHash: "h" } }]);
  const now = new Date("2026-10-07T06:31:00Z");
  const updated = await recordOtpDeliveryStatuses({ statuses: [{ id: "wamid.1", status: "failed", errors: [{ code: 131042, title: "Business eligibility payment issue" }] }] }, { db, now });
  assert.equal(updated, 1);
  assert.deepEqual(db.rows[0].metadata, { mode: "whatsapp", codeHash: "h", delivery: { status: "failed", error: "131042 Business eligibility payment issue", at: now.toISOString() } });
});

test("delivery status only moves forward and ignores unknown messages", async () => {
  const db = fakeDb([{ id: "c1", providerSid: "wamid.1", metadata: { delivery: { status: "read" } } }]);
  assert.equal(await recordOtpDeliveryStatuses({ statuses: [{ id: "wamid.1", status: "delivered" }, { id: "wamid.other", status: "failed" }] }, { db }), 0);
  assert.deepEqual(db.rows[0].metadata, { delivery: { status: "read" } });
});
