import {
  addDaysToKey,
  dateKeyIn,
  parseDateKey,
  zonedTimeToUtc,
} from "./timezone.ts";

export type AvailabilityWindow = {
  weekday: number;
  startMins: number;
  endMins: number;
  effectiveFrom?: Date | null;
  effectiveTo?: Date | null;
};

export type BusyInterval = { startAt: Date; endAt: Date };

export type SlotRequest = {
  clinicTimezone: string;
  /** Local date keys to generate for, e.g. ["2026-09-16", "2026-09-17"]. */
  dateKeys: string[];
  rules: AvailabilityWindow[];
  /** Existing appointments and BLOCKED exceptions. */
  busy: BusyInterval[];
  /** EXTRA_HOURS exceptions, which add availability outside the weekly rules. */
  extra?: BusyInterval[];
  durationMins: number;
  bufferMins?: number;
  granularityMins?: number;
  minNoticeMins?: number;
  maxAdvanceDays?: number;
  now?: Date;
};

export type Slot = { startAt: Date; endAt: Date };

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}

function ruleAppliesOn(rule: AvailabilityWindow, dayStartUtc: Date) {
  if (rule.effectiveFrom && dayStartUtc < rule.effectiveFrom) return false;
  if (rule.effectiveTo && dayStartUtc > rule.effectiveTo) return false;
  return true;
}

/**
 * Generates bookable slots.
 *
 * Availability rules are weekly wall-clock windows in the clinic's zone, so
 * every window is converted to a UTC instant per day rather than by adding
 * 24h — that is what keeps a 9am clinic at 9am across a DST change.
 *
 * `bufferMins` is padding the practitioner needs after a session; it extends
 * the block a booking occupies but not the appointment itself.
 */
export function generateSlots(req: SlotRequest): Slot[] {
  const {
    clinicTimezone,
    dateKeys,
    rules,
    busy,
    extra = [],
    durationMins,
    bufferMins = 0,
    granularityMins = 15,
    minNoticeMins = 0,
    maxAdvanceDays = 3650,
    now = new Date(),
  } = req;

  const earliest = now.getTime() + minNoticeMins * 60_000;
  const latestKey = addDaysToKey(dateKeyIn(now, clinicTimezone), maxAdvanceDays);
  const blockMins = durationMins + bufferMins;

  const busyRanges = [...busy, ...[]].map((b) => [b.startAt.getTime(), b.endAt.getTime()] as const);
  const slots: Slot[] = [];

  for (const key of dateKeys) {
    if (key > latestKey) continue;
    const { year, month, day } = parseDateKey(key);
    const dayStartUtc = zonedTimeToUtc({ year, month, day, hour: 0, minute: 0 }, clinicTimezone);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

    // Weekly windows for this weekday, plus any EXTRA_HOURS overlapping the day.
    const windows: Array<readonly [number, number]> = [];

    for (const rule of rules) {
      if (rule.weekday !== weekday) continue;
      if (!ruleAppliesOn(rule, dayStartUtc)) continue;
      const start = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(rule.startMins / 60), minute: rule.startMins % 60 },
        clinicTimezone,
      ).getTime();
      const end = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(rule.endMins / 60), minute: rule.endMins % 60 },
        clinicTimezone,
      ).getTime();
      if (end > start) windows.push([start, end] as const);
    }

    const dayEndUtc = zonedTimeToUtc(
      { ...parseDateKey(addDaysToKey(key, 1)), hour: 0, minute: 0 },
      clinicTimezone,
    ).getTime();
    for (const window of extra) {
      const s = Math.max(window.startAt.getTime(), dayStartUtc.getTime());
      const e = Math.min(window.endAt.getTime(), dayEndUtc);
      if (e > s) windows.push([s, e] as const);
    }

    for (const [windowStart, windowEnd] of windows) {
      for (let t = windowStart; t + blockMins * 60_000 <= windowEnd; t += granularityMins * 60_000) {
        if (t < earliest) continue;
        const blockEnd = t + blockMins * 60_000;
        if (busyRanges.some(([bs, be]) => overlaps(t, blockEnd, bs, be))) continue;
        slots.push({ startAt: new Date(t), endAt: new Date(t + durationMins * 60_000) });
      }
    }
  }

  slots.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // Overlapping weekly rules can emit the same instant twice.
  const seen = new Set<number>();
  return slots.filter((slot) => {
    const key = slot.startAt.getTime();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Groups slots into local days for the booking UI. */
export function groupSlotsByDay(slots: Slot[], timeZone: string) {
  const byDay = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = dateKeyIn(slot.startAt, timeZone);
    const list = byDay.get(key);
    if (list) list.push(slot);
    else byDay.set(key, [slot]);
  }
  return [...byDay.entries()].map(([dateKey, daySlots]) => ({ dateKey, slots: daySlots }));
}

export function nextNDateKeys(startKey: string, n: number) {
  return Array.from({ length: n }, (_, i) => addDaysToKey(startKey, i));
}
