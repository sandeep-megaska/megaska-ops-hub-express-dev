import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { resolveClinicBySlug } from "@/lib/tenant";
import { getAvailability } from "@/services/scheduling/availability";

/**
 * Public availability feed for the booking widget.
 *
 * Returns real bookable slots, not office hours. CORS is open because the
 * widget is embedded on tenant websites; the response contains no patient data
 * and no clinic data that isn't already on the public booking page.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clinicSlug: string }> },
) {
  const { clinicSlug } = await params;
  const clinic = await resolveClinicBySlug(clinicSlug);
  if (!clinic || clinic.status === "SUSPENDED") {
    return NextResponse.json({ error: "Unknown clinic" }, { status: 404 });
  }

  const serviceId = request.nextUrl.searchParams.get("serviceId");
  if (!serviceId) {
    return NextResponse.json({ error: "serviceId is required" }, { status: 400 });
  }

  const fromDateKey = request.nextUrl.searchParams.get("from") ?? undefined;
  const days = Number(request.nextUrl.searchParams.get("days") ?? 14);

  const availability = await getAvailability({
    clinicId: clinic.id,
    clinicTimezone: clinic.timezone,
    serviceId,
    practitionerId: request.nextUrl.searchParams.get("practitionerId") ?? undefined,
    fromDateKey,
    days: Number.isFinite(days) ? days : 14,
  });

  return NextResponse.json(
    {
      clinicTimezone: clinic.timezone,
      practitioners: availability.map((entry) => ({
        practitionerId: entry.practitionerId,
        practitionerName: entry.practitionerName,
        days: entry.days.map((day) => ({
          dateKey: day.dateKey,
          slots: day.slots.map((slot) => slot.startAt.toISOString()),
        })),
      })),
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } },
  );
}
