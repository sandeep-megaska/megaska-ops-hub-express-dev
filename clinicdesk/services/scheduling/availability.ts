import { clinicScope } from "@/lib/db";
import { dateKeyIn } from "./timezone";
import { generateSlots, groupSlotsByDay, nextNDateKeys, type Slot } from "./slots";

export type AvailabilityQuery = {
  clinicId: string;
  clinicTimezone: string;
  serviceId: string;
  practitionerId?: string;
  /** Local date key to start from; defaults to today in the clinic's zone. */
  fromDateKey?: string;
  days?: number;
};

export type PractitionerAvailability = {
  practitionerId: string;
  practitionerName: string;
  days: Array<{ dateKey: string; slots: Slot[] }>;
};

/**
 * Real availability, not a "we'll call you back" form. Slots are computed from
 * the practitioner's weekly rules minus existing appointments and blocks.
 */
export async function getAvailability(
  query: AvailabilityQuery,
): Promise<PractitionerAvailability[]> {
  const db = clinicScope(query.clinicId);
  const now = new Date();
  const fromKey = query.fromDateKey ?? dateKeyIn(now, query.clinicTimezone);
  const days = Math.min(query.days ?? 14, 60);
  const dateKeys = nextNDateKeys(fromKey, days);

  const [service, settings] = await Promise.all([
    db.service.findFirst({
      where: { id: query.serviceId, isActive: true },
      include: { practitioners: { where: { isBookable: true }, select: { id: true, fullName: true } } },
    }),
    db.clinicSettings.findFirst({ where: {} }),
  ]);
  if (!service) return [];

  // A service with no explicit practitioners is offered by everyone bookable.
  let practitioners = service.practitioners;
  if (practitioners.length === 0) {
    practitioners = await db.practitioner.findMany({
      where: { isBookable: true },
      select: { id: true, fullName: true },
      orderBy: { displayOrder: "asc" },
    });
  }
  if (query.practitionerId) {
    practitioners = practitioners.filter((p) => p.id === query.practitionerId);
  }
  if (practitioners.length === 0) return [];

  const practitionerIds = practitioners.map((p) => p.id);
  const rangeStart = new Date(now.getTime() - 24 * 3600_000);
  const rangeEnd = new Date(
    now.getTime() + (days + 2) * 24 * 3600_000,
  );

  const [rules, appointments, exceptions] = await Promise.all([
    db.availabilityRule.findMany({ where: { practitionerId: { in: practitionerIds } } }),
    db.appointment.findMany({
      where: {
        practitionerId: { in: practitionerIds },
        startAt: { gte: rangeStart, lte: rangeEnd },
        status: { in: ["REQUESTED", "CONFIRMED", "ARRIVED"] },
      },
      // `blockEndAt`, not `endAt`: the slot stays occupied through the
      // previous session's turnaround buffer.
      select: { practitionerId: true, startAt: true, blockEndAt: true },
    }),
    db.scheduleException.findMany({
      where: {
        practitionerId: { in: practitionerIds },
        startAt: { lte: rangeEnd },
        endAt: { gte: rangeStart },
      },
    }),
  ]);

  return practitioners.map((practitioner) => {
    const mine = (id: string) => id === practitioner.id;
    const slots = generateSlots({
      clinicTimezone: query.clinicTimezone,
      dateKeys,
      rules: rules.filter((r) => mine(r.practitionerId)),
      busy: [
        ...appointments
          .filter((a) => mine(a.practitionerId))
          .map((a) => ({ startAt: a.startAt, endAt: a.blockEndAt })),
        ...exceptions.filter((e) => mine(e.practitionerId) && e.kind === "BLOCKED"),
      ],
      extra: exceptions.filter((e) => mine(e.practitionerId) && e.kind === "EXTRA_HOURS"),
      durationMins: service.durationMins,
      bufferMins: service.bufferMins,
      granularityMins: settings?.slotGranularityMins ?? 15,
      minNoticeMins: settings?.minNoticeMins ?? 120,
      maxAdvanceDays: settings?.maxAdvanceDays ?? 60,
      now,
    });

    return {
      practitionerId: practitioner.id,
      practitionerName: practitioner.fullName,
      days: groupSlotsByDay(slots, query.clinicTimezone),
    };
  });
}
