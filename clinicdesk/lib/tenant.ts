import { headers } from "next/headers";
import { cache } from "react";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { HOST_SLUG } from "@/proxy";

export type ResolvedClinic = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
  locale: string;
  status: string;
  primaryColor: string | null;
  logoUrl: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  websiteUrl: string | null;
  addressLines: string[];
};

const SELECT = {
  id: true,
  slug: true,
  name: true,
  timezone: true,
  currency: true,
  locale: true,
  status: true,
  primaryColor: true,
  logoUrl: true,
  publicPhone: true,
  publicEmail: true,
  websiteUrl: true,
  addressLines: true,
} as const;

/**
 * Resolves the tenant for a public (patient-facing) request.
 *
 * `slug` comes from the route segment the proxy rewrote to. The sentinel
 * `~host` means the request arrived on a tenant's own domain, so we resolve it
 * through the verified `ClinicDomain` table instead — an unverified domain must
 * not be able to claim a tenant.
 *
 * Deduped per request with React `cache` so a layout and its page share one query.
 */
export const resolveClinicBySlug = cache(
  async (slug: string): Promise<ResolvedClinic | null> => {
    if (slug !== HOST_SLUG) {
      return prisma.clinic.findUnique({ where: { slug }, select: SELECT });
    }

    const hostname = (await headers()).get("x-clinic-hostname");
    if (!hostname) return null;

    const domain = await prisma.clinicDomain.findUnique({
      where: { hostname },
      select: { verifiedAt: true, clinic: { select: SELECT } },
    });
    if (!domain?.verifiedAt) return null;
    return domain.clinic;
  },
);

/** Same, but 404s instead of returning null, and refuses suspended tenants. */
export async function requireClinicBySlug(slug: string): Promise<ResolvedClinic> {
  const clinic = await resolveClinicBySlug(decodeURIComponent(slug));
  if (!clinic || clinic.status === "SUSPENDED") notFound();
  return clinic;
}
