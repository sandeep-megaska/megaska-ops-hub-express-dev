import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { requireClinicBySlug } from "@/lib/tenant";
import { BookingWidget } from "@/components/booking/booking-widget";
import { EmbedResizer } from "@/components/booking/embed-resizer";

// `params` and `searchParams` are Promises in Next 16
// (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md).

type Props = {
  params: Promise<{ clinicSlug: string }>;
  searchParams: Promise<{ embed?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clinicSlug } = await params;
  const clinic = await requireClinicBySlug(clinicSlug);
  return {
    title: `Book an appointment — ${clinic.name}`,
    description: `Book a physiotherapy appointment at ${clinic.name}.`,
  };
}

export default async function BookingPage({ params, searchParams }: Props) {
  const { clinicSlug } = await params;
  const { embed } = await searchParams;
  const clinic = await requireClinicBySlug(clinicSlug);
  const embedded = embed === "1";

  const services = await prisma.service.findMany({
    where: { clinicId: clinic.id, isActive: true },
    orderBy: { displayOrder: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      durationMins: true,
      priceMinor: true,
      isTeleconsult: true,
    },
  });

  const widget = (
    <BookingWidget
      clinicSlug={clinic.slug}
      clinicName={clinic.name}
      clinicTimezone={clinic.timezone}
      currency={clinic.currency}
      locale={clinic.locale}
      services={services}
      embedded={embedded}
    />
  );

  // Embedded mode renders bare: the host page supplies its own branding and
  // heading, and a second masthead inside the iframe looks broken.
  if (embedded) {
    return (
      <main className="bg-transparent p-3">
        <EmbedResizer />
        {services.length === 0 ? <NoServices /> : widget}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        {clinic.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clinic.logoUrl} alt="" className="mb-3 h-12 w-auto" />
        )}
        <h1 className="text-2xl font-bold text-ink">{clinic.name}</h1>
        <p className="mt-1 text-ink-soft">Book an appointment</p>
        {clinic.addressLines.length > 0 && (
          <p className="mt-2 text-sm text-ink-faint">{clinic.addressLines.join(", ")}</p>
        )}
      </header>

      {services.length === 0 ? <NoServices /> : widget}

      <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-faint">
        {clinic.publicPhone && <p>Prefer to call? {clinic.publicPhone}</p>}
        {clinic.websiteUrl && (
          <p className="mt-1">
            <a className="underline" href={clinic.websiteUrl}>
              {clinic.websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          </p>
        )}
      </footer>
    </main>
  );
}

function NoServices() {
  return (
    <p className="card p-4 text-sm text-ink-soft">
      Online booking isn&apos;t set up yet. Please contact the clinic directly.
    </p>
  );
}
