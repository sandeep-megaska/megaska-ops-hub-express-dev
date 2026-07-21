import assert from "node:assert/strict";
import test from "node:test";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { replaceCustomerSessionAfterOtp } from "./customer-session-replacement.ts";

test("verifying B in A's browser revokes A and creates the dashboard session for B", async () => {
  const sessions = [{ id: "session-a", customerProfileId: "profile-a", sessionTokenHash: "hash:token-a", revokedAt: null as Date | null }];
  const db: any = {
    authSession: {
      findFirst: async ({ where }: any) => sessions.find((row) => row.sessionTokenHash === where.sessionTokenHash && !row.revokedAt) || null,
      updateMany: async ({ where, data }: any) => { const matches = sessions.filter((row) => row.sessionTokenHash === where.sessionTokenHash && !row.revokedAt); matches.forEach((row) => { row.revokedAt = data.revokedAt; }); return { count: matches.length }; },
      create: async ({ data }: any) => { const row = { id: "session-b", ...data, revokedAt: null }; sessions.push(row); return row; },
    },
    async $transaction(callback: any) { return callback(this); },
  };

  const result = await replaceCustomerSessionAfterOtp(
    { customerProfileId: "profile-b", previousSessionToken: "token-a" },
    db,
    { generateToken: () => "token-b", hashToken: (token) => `hash:${token}`, now: () => new Date("2026-07-21T00:00:00Z") },
  );

  assert.equal(result.previousSession?.customerProfileId, "profile-a");
  assert.equal(sessions[0].revokedAt?.toISOString(), "2026-07-21T00:00:00.000Z");
  assert.equal(result.session.customerProfileId, "profile-b");
  assert.equal(result.sessionToken, "token-b");
});

test("a first login creates a session without requiring a previous browser identity", async () => {
  let findCalls = 0;
  const db: any = {
    authSession: {
      findFirst: async () => { findCalls += 1; return null; },
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => ({ id: "session-a", ...data }),
    },
    async $transaction(callback: any) { return callback(this); },
  };
  const result = await replaceCustomerSessionAfterOtp(
    { customerProfileId: "profile-a" }, db,
    { generateToken: () => "token-a", hashToken: (token) => `hash:${token}`, now: () => new Date("2026-07-21T00:00:00Z") },
  );
  assert.equal(findCalls, 0);
  assert.equal(result.session.customerProfileId, "profile-a");
});
