/**
 * Timezone helpers built on `Intl` — no dependency, correct across DST.
 *
 * The rule for the whole app: instants are stored UTC. Availability is authored
 * in the clinic's wall-clock time. Patients abroad see slots in their own zone.
 * Anything that converts between those three lives here.
 */

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let fmt = partsFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function wallClockIn(date: Date, timeZone: string): WallClock {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Intl renders midnight as hour 24 in some ICU versions; normalise it.
  const hour = get("hour");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: hour === 24 ? 0 : hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
export function offsetMinutes(date: Date, timeZone: string): number {
  const wc = wallClockIn(date, timeZone);
  const asUtc = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, wc.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000;
}

/**
 * Converts a wall-clock time in `timeZone` to the corresponding UTC instant.
 *
 * Two passes: the first guesses using the offset at the naive timestamp, the
 * second corrects it if that guess landed on the other side of a DST boundary.
 * India never needs the second pass; London in late March does.
 */
export function zonedTimeToUtc(
  { year, month, day, hour = 0, minute = 0 }: Partial<WallClock> & { year: number; month: number; day: number },
  timeZone: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = offsetMinutes(new Date(naive), timeZone);
  let utc = naive - offset * 60_000;
  const corrected = offsetMinutes(new Date(utc), timeZone);
  if (corrected !== offset) {
    offset = corrected;
    utc = naive - offset * 60_000;
  }
  return new Date(utc);
}

/** Local date key, "2026-09-16", for grouping slots by day. */
export function dateKeyIn(date: Date, timeZone: string): string {
  const { year, month, day } = wallClockIn(date, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return { year, month, day };
}

/** 0 = Sunday … 6 = Saturday, in the given zone. */
export function weekdayIn(date: Date, timeZone: string): number {
  const { year, month, day } = wallClockIn(date, timeZone);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function minutesSinceMidnight(date: Date, timeZone: string): number {
  const { hour, minute } = wallClockIn(date, timeZone);
  return hour * 60 + minute;
}

export function addDaysToKey(key: string, days: number): string {
  const { year, month, day } = parseDateKey(key);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return dateKeyIn(d, "UTC");
}

export function formatTimeIn(date: Date, timeZone: string, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export function formatDateIn(date: Date, timeZone: string, locale = "en-IN") {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function formatDateTimeIn(date: Date, timeZone: string, locale = "en-IN") {
  return `${formatDateIn(date, timeZone, locale)}, ${formatTimeIn(date, timeZone, locale)}`;
}

/** "IST", "GMT+5:30" — shown next to every slot when zones differ. */
export function zoneAbbreviation(date: Date, timeZone: string, locale = "en-IN") {
  const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" }).formatToParts(date);
  return parts.find((p) => p.type === "timeZoneName")?.value ?? timeZone;
}

export function sameZone(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return true;
  return a === b;
}
