import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateKeyIn,
  offsetMinutes,
  wallClockIn,
  weekdayIn,
  zonedTimeToUtc,
} from "./timezone.ts";

test("India's half-hour offset is handled", () => {
  const utc = zonedTimeToUtc({ year: 2026, month: 9, day: 16, hour: 9, minute: 30 }, "Asia/Kolkata");
  assert.equal(utc.toISOString(), "2026-09-16T04:00:00.000Z");
  assert.equal(offsetMinutes(utc, "Asia/Kolkata"), 330);
});

test("midnight renders as hour 0, not 24", () => {
  const utc = zonedTimeToUtc({ year: 2026, month: 9, day: 16, hour: 0, minute: 0 }, "Asia/Kolkata");
  assert.equal(wallClockIn(utc, "Asia/Kolkata").hour, 0);
  assert.equal(dateKeyIn(utc, "Asia/Kolkata"), "2026-09-16");
});

test("a 9am clinic stays 9am across a DST change", () => {
  // London: BST before 25 Oct 2026, GMT after. Wall-clock 09:00 both times.
  const before = zonedTimeToUtc({ year: 2026, month: 10, day: 24, hour: 9 }, "Europe/London");
  const after = zonedTimeToUtc({ year: 2026, month: 10, day: 26, hour: 9 }, "Europe/London");

  assert.equal(before.toISOString(), "2026-10-24T08:00:00.000Z", "BST is UTC+1");
  assert.equal(after.toISOString(), "2026-10-26T09:00:00.000Z", "GMT is UTC+0");

  assert.equal(wallClockIn(before, "Europe/London").hour, 9);
  assert.equal(wallClockIn(after, "Europe/London").hour, 9);
});

test("a wall-clock time skipped by a spring-forward still resolves", () => {
  // 01:30 on 29 Mar 2026 does not exist in London; it must not throw or drift
  // into the previous day.
  const utc = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, "Europe/London");
  assert.ok(!Number.isNaN(utc.getTime()));
  assert.equal(dateKeyIn(utc, "Europe/London"), "2026-03-29");
});

test("the same instant is a different local date either side of the dateline", () => {
  const instant = new Date("2026-09-16T20:00:00.000Z");
  assert.equal(dateKeyIn(instant, "Asia/Kolkata"), "2026-09-17");
  assert.equal(dateKeyIn(instant, "America/Los_Angeles"), "2026-09-16");
});

test("weekday is computed in the clinic's zone, not the server's", () => {
  // 21:00 UTC Saturday is already Sunday in Kolkata.
  const instant = new Date("2026-09-19T20:00:00.000Z");
  assert.equal(weekdayIn(instant, "Asia/Kolkata"), 0);
  assert.equal(weekdayIn(instant, "Europe/London"), 6);
});
