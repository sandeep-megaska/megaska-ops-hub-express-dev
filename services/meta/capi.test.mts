import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  buildServerEvent,
  buildUserData,
  deterministicEventId,
  isMetaCapiConfigured,
  resolveMetaCapiConfig,
  sendCapiEvents,
} from "./capi.ts";

function withEnv(vars: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return () => {
    for (const key of Object.keys(previous)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

const sha256 = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

test("isMetaCapiConfigured requires both pixel id and access token", () => {
  assert.equal(isMetaCapiConfigured({ META_PIXEL_ID: "1", META_CAPI_ACCESS_TOKEN: "t" }), true);
  assert.equal(isMetaCapiConfigured({ META_PIXEL_ID: "1" }), false);
  assert.equal(isMetaCapiConfigured({ META_CAPI_ACCESS_TOKEN: "t" }), false);
  assert.equal(isMetaCapiConfigured({}), false);
});

test("resolveMetaCapiConfig returns null when unconfigured, config when set", () => {
  assert.equal(resolveMetaCapiConfig({}), null);
  const cfg = resolveMetaCapiConfig({
    META_PIXEL_ID: "px",
    META_CAPI_ACCESS_TOKEN: "tok",
    META_CAPI_TEST_EVENT_CODE: "TEST123",
  });
  assert.equal(cfg?.pixelId, "px");
  assert.equal(cfg?.accessToken, "tok");
  assert.equal(cfg?.graphApiVersion, "v21.0"); // default
  assert.equal(cfg?.testEventCode, "TEST123");
});

test("deterministicEventId is stable and dedup-friendly", () => {
  const a = deterministicEventId("Purchase", "order-42");
  const b = deterministicEventId("Purchase", "order-42");
  const c = deterministicEventId("Purchase", "order-99");
  assert.equal(a, b); // same logical event -> same id (idempotent retries)
  assert.notEqual(a, c);
  assert.equal(a.length, 32);
});

test("buildUserData hashes email lowercased and trimmed", () => {
  const ud = buildUserData({ email: "  Foo@Example.COM " });
  assert.deepEqual(ud.em, [sha256("foo@example.com")]);
});

test("buildUserData normalizes an Indian phone to digits-only with country code, then hashes", () => {
  const ud = buildUserData({ phone: "98765 43210", phoneCountry: "IN" });
  // Expect E.164 91XXXXXXXXXX with '+' stripped -> "919876543210"
  assert.deepEqual(ud.ph, [sha256("919876543210")]);
});

test("buildUserData strips whitespace from names before hashing and passes browser ids raw", () => {
  const ud = buildUserData({
    firstName: "  Jane ",
    lastName: "Doe",
    clientIpAddress: "203.0.113.9",
    clientUserAgent: "UA/1.0",
    fbp: "fb.1.123.456",
  });
  assert.deepEqual(ud.fn, [sha256("jane")]);
  assert.deepEqual(ud.ln, [sha256("doe")]);
  assert.equal(ud.client_ip_address, "203.0.113.9"); // NOT hashed
  assert.equal(ud.client_user_agent, "UA/1.0");
  assert.equal(ud.fbp, "fb.1.123.456");
});

test("buildUserData omits absent fields entirely", () => {
  const ud = buildUserData({ email: null, phone: "" });
  assert.equal("em" in ud, false);
  assert.equal("ph" in ud, false);
});

test("buildServerEvent clamps an event older than 7 days into the window", () => {
  const now = 1_700_000_000_000;
  const tenDaysAgo = now - 10 * 24 * 60 * 60 * 1000;
  const event = buildServerEvent(
    { eventName: "Purchase", eventId: "e1", eventTimeMs: tenDaysAgo, user: { email: "a@b.com" } },
    now,
  );
  const sevenDaysAgoSec = Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
  assert.equal(event.event_time, sevenDaysAgoSec);
  assert.equal(event.action_source, "website"); // default
});

test("buildServerEvent never emits a future event_time", () => {
  const now = 1_700_000_000_000;
  const event = buildServerEvent(
    { eventName: "Purchase", eventId: "e1", eventTimeMs: now + 60_000, user: {} },
    now,
  );
  assert.equal(event.event_time, Math.floor(now / 1000));
});

test("sendCapiEvents is a no-op disabled result when unconfigured", async () => {
  const restore = withEnv({ META_PIXEL_ID: undefined, META_CAPI_ACCESS_TOKEN: undefined });
  const result = await sendCapiEvents([
    { eventName: "Purchase", eventId: "e1", user: { email: "a@b.com" } },
  ]);
  assert.deepEqual(result, { ok: true, disabled: true });
  restore();
});

test("sendCapiEvents posts hashed data to Meta and reports events_received", async () => {
  type WireBody = { data: Array<{ user_data: Record<string, string[]> }>; test_event_code?: string };
  const calls: Array<{ url: string; body: WireBody }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as WireBody });
    return new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace-xyz" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await sendCapiEvents(
      [{ eventName: "Purchase", eventId: "e1", user: { email: "a@b.com" }, customData: { value: 999, currency: "INR" } }],
      { config: { pixelId: "px", accessToken: "SECRET", graphApiVersion: "v21.0", testEventCode: "T1" } },
    );
    assert.equal(result.ok, true);
    assert.equal(result.eventsReceived, 1);
    assert.equal(result.fbTraceId, "trace-xyz");

    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /graph\.facebook\.com\/v21\.0\/px\/events/);
    assert.match(calls[0].url, /access_token=SECRET/);
    assert.equal(calls[0].body.test_event_code, "T1");
    // Raw email must never appear on the wire — only its hash.
    const wire = JSON.stringify(calls[0].body);
    assert.equal(wire.includes("a@b.com"), false);
    assert.equal(calls[0].body.data[0].user_data.em[0], sha256("a@b.com"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendCapiEvents surfaces a Meta error without throwing or leaking the token", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: { message: "Invalid parameter" }, fbtrace_id: "t2" }), {
      status: 400,
    })) as typeof fetch;
  try {
    const result = await sendCapiEvents(
      [{ eventName: "Purchase", eventId: "e1", user: {} }],
      { config: { pixelId: "px", accessToken: "SECRET", graphApiVersion: "v21.0" } },
    );
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.error, "Invalid parameter");
    assert.equal(result.fbTraceId, "t2");
    assert.equal(String(result.error).includes("SECRET"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
