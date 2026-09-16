"use client";

import { useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { submitBooking, type BookingResult } from "@/app/book/[clinicSlug]/actions";
import { CONSENT_TEXT } from "@/lib/consent";

export type WidgetService = {
  id: string;
  name: string;
  description: string | null;
  durationMins: number;
  priceMinor: number | null;
  isTeleconsult: boolean;
};

type AvailabilityResponse = {
  clinicTimezone: string;
  practitioners: Array<{
    practitionerId: string;
    practitionerName: string;
    days: Array<{ dateKey: string; slots: string[] }>;
  }>;
};

type Step = "service" | "slot" | "details" | "done";

function formatMoney(minor: number | null, currency: string, locale: string) {
  if (minor === null) return "Price on request";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(minor / 100);
}

const neverChanges = () => () => {};

function readBrowserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

/**
 * The patient's timezone, read on the client only.
 *
 * `useSyncExternalStore` with an empty server snapshot is the supported way to
 * reach a browser-only value without a hydration mismatch and without a
 * setState-in-effect cascade.
 */
function useBrowserTimezone() {
  return useSyncExternalStore(neverChanges, readBrowserTimezone, () => "");
}

/**
 * Four steps: service, time, details, done. The patient is never asked to
 * create an account, and never sees a "we'll call you back" form — the slots
 * shown are the slots that exist.
 */
export function BookingWidget({
  clinicSlug,
  clinicName,
  clinicTimezone,
  currency,
  locale,
  services,
  embedded = false,
}: {
  clinicSlug: string;
  clinicName: string;
  clinicTimezone: string;
  currency: string;
  locale: string;
  services: WidgetService[];
  embedded?: boolean;
}) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<WidgetService | null>(null);
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [activeDay, setActiveDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ iso: string; practitionerId: string; practitionerName: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<BookingResult, { ok: true }> | null>(null);
  const [pending, startTransition] = useTransition();

  const patientTimezone = useBrowserTimezone();
  const showBothZones = Boolean(patientTimezone) && patientTimezone !== clinicTimezone;

  // Availability is fetched in response to picking a service rather than in an
  // effect. `requestId` drops the response of a service the patient has since
  // changed away from — tapping two services quickly must not show the slots of
  // the first one under the heading of the second.
  const requestId = useRef(0);

  async function chooseService(item: WidgetService) {
    const id = ++requestId.current;
    setService(item);
    setSlot(null);
    setStep("slot");
    setError(null);
    setAvailability(null);
    setActiveDay(null);
    setLoadingSlots(true);

    try {
      const response = await fetch(
        `/api/public/${encodeURIComponent(clinicSlug)}/availability?serviceId=${item.id}&days=21`,
      );
      if (!response.ok) throw new Error("unavailable");
      const data: AvailabilityResponse = await response.json();
      if (id !== requestId.current) return;
      setAvailability(data);
      const firstDay = data.practitioners.flatMap((p) => p.days).find((d) => d.slots.length > 0);
      setActiveDay(firstDay?.dateKey ?? null);
    } catch {
      if (id === requestId.current) {
        setError("Couldn't load available times. Please call the clinic.");
      }
    } finally {
      if (id === requestId.current) setLoadingSlots(false);
    }
  }

  const days = useMemo(() => {
    if (!availability) return [];
    const merged = new Map<string, number>();
    for (const practitioner of availability.practitioners) {
      for (const day of practitioner.days) {
        merged.set(day.dateKey, (merged.get(day.dateKey) ?? 0) + day.slots.length);
      }
    }
    return [...merged.entries()]
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, count]) => ({ dateKey, count }));
  }, [availability]);

  const slotsForDay = useMemo(() => {
    if (!availability || !activeDay) return [];
    return availability.practitioners.flatMap((practitioner) => {
      const day = practitioner.days.find((entry) => entry.dateKey === activeDay);
      return (day?.slots ?? []).map((iso) => ({
        iso,
        practitionerId: practitioner.practitionerId,
        practitionerName: practitioner.practitionerName,
      }));
    });
  }, [availability, activeDay]);

  function timeIn(iso: string, timeZone: string) {
    return new Intl.DateTimeFormat(locale, {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  }

  function dayLabel(dateKey: string) {
    const [y, m, d] = dateKey.split("-").map(Number);
    return new Intl.DateTimeFormat(locale, {
      timeZone: clinicTimezone,
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(new Date(Date.UTC(y, m - 1, d, 6)));
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const response = await submitBooking(formData);
      if (response.ok) {
        setResult(response);
        setStep("done");
      } else {
        setError(response.error);
      }
    });
  }

  if (step === "done" && result) {
    return (
      <div className="card p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-good-soft text-2xl">
          ✓
        </div>
        <h2 className="mt-4 text-xl font-bold">Appointment confirmed</h2>
        <p className="mt-2 text-ink-soft">
          {result.serviceName} with {result.practitionerName}
        </p>
        <p className="mt-3 text-lg font-semibold">
          {new Intl.DateTimeFormat(locale, {
            timeZone: clinicTimezone,
            weekday: "long",
            day: "numeric",
            month: "long",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(result.startAtIso))}
        </p>
        {showBothZones && (
          <p className="mt-1 text-sm text-ink-faint">
            {timeIn(result.startAtIso, patientTimezone)} your time ({patientTimezone})
          </p>
        )}
        <p className="mt-4 text-sm text-ink-soft">
          We&apos;ve sent a confirmation. Your patient ID at {clinicName} is{" "}
          <span className="font-semibold text-ink">{result.reference}</span>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ol className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {(["service", "slot", "details"] as const).map((name, index) => (
          <li key={name} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full ${
                step === name ? "bg-brand text-white" : "bg-surface-sunk text-ink-faint"
              }`}
            >
              {index + 1}
            </span>
            <span className={step === name ? "text-ink" : undefined}>
              {name === "service" ? "Service" : name === "slot" ? "Time" : "Details"}
            </span>
          </li>
        ))}
      </ol>

      {error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {step === "service" && (
        <div className="space-y-2">
          {services.map((item) => (
            <button
              key={item.id}
              type="button"
              className="card tap w-full px-4 py-3 text-left hover:border-brand"
              onClick={() => void chooseService(item)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold">{item.name}</span>
                <span className="text-sm font-semibold text-brand">
                  {formatMoney(item.priceMinor, currency, locale)}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-ink-soft">
                {item.durationMins} min{item.isTeleconsult ? " · Video consultation" : ""}
              </div>
              {item.description && (
                <p className="mt-1 text-sm text-ink-faint">{item.description}</p>
              )}
            </button>
          ))}
        </div>
      )}

      {step === "slot" && service && (
        <div className="space-y-4">
          <button type="button" className="btn btn-ghost -ml-3" onClick={() => setStep("service")}>
            ← {service.name}
          </button>

          {loadingSlots && <p className="text-sm text-ink-soft">Finding available times…</p>}

          {!loadingSlots && days.length === 0 && (
            <p className="card p-4 text-sm text-ink-soft">
              No times available in the next three weeks. Please call the clinic.
            </p>
          )}

          {days.length > 0 && (
            <>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((day) => (
                  <button
                    key={day.dateKey}
                    type="button"
                    onClick={() => setActiveDay(day.dateKey)}
                    className={`tap shrink-0 rounded-lg border px-3 text-sm font-semibold ${
                      activeDay === day.dateKey
                        ? "border-brand bg-brand-soft text-brand-dark"
                        : "border-line bg-surface text-ink-soft"
                    }`}
                  >
                    {dayLabel(day.dateKey)}
                  </button>
                ))}
              </div>

              {showBothZones && (
                <p className="rounded-lg bg-brand-soft px-3 py-2 text-xs text-brand-dark">
                  Times are shown in clinic time ({clinicTimezone}) with your local time below.
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {slotsForDay.map((entry) => (
                  <button
                    key={`${entry.practitionerId}-${entry.iso}`}
                    type="button"
                    onClick={() => {
                      setSlot(entry);
                      setStep("details");
                    }}
                    className="tap flex flex-col items-center justify-center rounded-lg border border-line bg-surface px-1 text-sm font-semibold hover:border-brand"
                  >
                    <span>{timeIn(entry.iso, clinicTimezone)}</span>
                    {showBothZones && (
                      <span className="text-[0.65rem] font-normal text-ink-faint">
                        {timeIn(entry.iso, patientTimezone)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {step === "details" && service && slot && (
        <form action={handleSubmit} className="space-y-4">
          <button type="button" className="btn btn-ghost -ml-3" onClick={() => setStep("slot")}>
            ← Change time
          </button>

          <div className="card px-4 py-3 text-sm">
            <div className="font-semibold">{service.name}</div>
            <div className="text-ink-soft">
              {new Intl.DateTimeFormat(locale, {
                timeZone: clinicTimezone,
                weekday: "long",
                day: "numeric",
                month: "long",
                hour: "numeric",
                minute: "2-digit",
              }).format(new Date(slot.iso))}{" "}
              · {slot.practitionerName}
            </div>
            {showBothZones && (
              <div className="text-ink-faint">
                {timeIn(slot.iso, patientTimezone)} your time
              </div>
            )}
          </div>

          <input type="hidden" name="clinicSlug" value={clinicSlug} />
          <input type="hidden" name="serviceId" value={service.id} />
          <input type="hidden" name="practitionerId" value={slot.practitionerId} />
          <input type="hidden" name="startAt" value={slot.iso} />
          <input type="hidden" name="timezone" value={patientTimezone} />
          <input type="hidden" name="embedded" value={embedded ? "1" : "0"} />

          <div>
            <label className="field-label" htmlFor="fullName">
              Patient&apos;s full name
            </label>
            <input id="fullName" name="fullName" className="input" required autoComplete="name" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="phone">
                Mobile number
              </label>
              <input
                id="phone"
                name="phone"
                className="input"
                required
                inputMode="tel"
                autoComplete="tel"
                placeholder="+91 98470 00000"
              />
              <p className="mt-1 text-xs text-ink-faint">
                Include the country code if you&apos;re outside India.
              </p>
            </div>
            <div>
              <label className="field-label" htmlFor="email">
                Email <span className="font-normal text-ink-faint">(optional)</span>
              </label>
              <input id="email" name="email" type="email" className="input" autoComplete="email" />
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="reasonForVisit">
              What brings you in?
            </label>
            <textarea
              id="reasonForVisit"
              name="reasonForVisit"
              className="textarea"
              placeholder="e.g. Lower back pain for the last 3 weeks, worse when sitting."
            />
          </div>

          <label className="flex gap-3 rounded-lg bg-surface-sunk p-3 text-sm text-ink-soft">
            <input type="checkbox" name="consent" className="mt-1 h-4 w-4 shrink-0" required />
            <span>{CONSENT_TEXT}</span>
          </label>

          <button type="submit" className="btn btn-primary w-full" disabled={pending}>
            {pending ? "Confirming…" : "Confirm appointment"}
          </button>
        </form>
      )}
    </div>
  );
}
