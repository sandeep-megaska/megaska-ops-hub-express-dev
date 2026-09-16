import { test } from "node:test";
import assert from "node:assert/strict";
import { generateSlots } from "./slots.ts";
import { zonedTimeToUtc } from "./timezone.ts";

const TZ = "Asia/Kolkata";
const NOW = new Date("2026-09-16T00:00:00.000Z"); // 05:30 IST, Wednesday

/** Mon–Sat 09:00–13:00 clinic-local. 16 Sep 2026 is a Wednesday. */
const RULES = [3].map((weekday) => ({ weekday, startMins: 9 * 60, endMins: 13 * 60 }));

function base(overrides = {}) {
  return {
    clinicTimezone: TZ,
    dateKeys: ["2026-09-16"],
    rules: RULES,
    busy: [],
    durationMins: 30,
    granularityMins: 15,
    minNoticeMins: 0,
    now: NOW,
    ...overrides,
  };
}

test("slots fill the window at the configured granularity", () => {
  const slots = generateSlots(base());
  // 09:00–13:00 with 30-minute sessions on a 15-minute grid: last start 12:30.
  assert.equal(slots.length, 15);
  assert.equal(slots[0].startAt.toISOString(), "2026-09-16T03:30:00.000Z"); // 09:00 IST
  assert.equal(slots.at(-1)!.startAt.toISOString(), "2026-09-16T07:00:00.000Z"); // 12:30 IST
});

test("a booked appointment removes every overlapping slot", () => {
  const busyStart = zonedTimeToUtc({ year: 2026, month: 9, day: 16, hour: 10 }, TZ);
  const slots = generateSlots(
    base({ busy: [{ startAt: busyStart, endAt: new Date(busyStart.getTime() + 30 * 60_000) }] }),
  );
  const clash = slots.find((slot) => {
    const start = slot.startAt.getTime();
    return start < busyStart.getTime() + 30 * 60_000 && busyStart.getTime() < start + 30 * 60_000;
  });
  assert.equal(clash, undefined);
});

test("the buffer extends the block a booking occupies, not the appointment", () => {
  const withBuffer = generateSlots(base({ bufferMins: 30 }));
  const without = generateSlots(base());
  assert.ok(withBuffer.length < without.length, "a buffer must reduce the number of slots");
  const first = withBuffer[0];
  assert.equal(
    first.endAt.getTime() - first.startAt.getTime(),
    30 * 60_000,
    "the appointment itself stays 30 minutes",
  );
});

test("minimum notice hides imminent slots", () => {
  // 07:00 IST, so a 4h notice rules out everything before 11:00.
  const now = zonedTimeToUtc({ year: 2026, month: 9, day: 16, hour: 7 }, TZ);
  const slots = generateSlots(base({ now, minNoticeMins: 240 }));
  assert.ok(slots.length > 0);
  const earliest = slots[0].startAt.getTime();
  assert.ok(earliest >= now.getTime() + 240 * 60_000);
});

test("a day with no matching rule yields nothing", () => {
  // 20 Sep 2026 is a Sunday; the only rule is for Wednesday.
  const slots = generateSlots(base({ dateKeys: ["2026-09-20"] }));
  assert.equal(slots.length, 0);
});

test("EXTRA_HOURS adds availability outside the weekly rules", () => {
  const start = zonedTimeToUtc({ year: 2026, month: 9, day: 20, hour: 10 }, TZ);
  const slots = generateSlots(
    base({
      dateKeys: ["2026-09-20"],
      extra: [{ startAt: start, endAt: new Date(start.getTime() + 2 * 3600_000) }],
    }),
  );
  assert.ok(slots.length > 0, "a Sunday clinic added by exception should be bookable");
  assert.ok(slots.every((slot) => slot.startAt >= start));
});

test("overlapping rules never produce a duplicate slot", () => {
  const slots = generateSlots(
    base({
      rules: [
        { weekday: 3, startMins: 9 * 60, endMins: 13 * 60 },
        { weekday: 3, startMins: 10 * 60, endMins: 12 * 60 },
      ],
    }),
  );
  const seen = new Set(slots.map((slot) => slot.startAt.toISOString()));
  assert.equal(seen.size, slots.length);
});

test("maxAdvanceDays caps how far ahead patients can book", () => {
  const slots = generateSlots(base({ dateKeys: ["2026-12-16"], maxAdvanceDays: 30 }));
  assert.equal(slots.length, 0);
});
