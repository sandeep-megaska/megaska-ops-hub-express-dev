import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16 renamed the `middleware` convention to `proxy`
// (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
//
// Proxy may be deployed to the CDN edge and must not rely on shared modules or
// a database, so tenant resolution here is pure string work. Only subdomains of
// our own root domain are resolved to a slug; anything else is treated as a
// tenant's custom domain and handed to the app layer, which looks it up in
// `ClinicDomain`. See lib/tenant.ts.

const ROOT_DOMAIN = process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "clinicdesk.local:3000";
const RESERVED_SUBDOMAINS = new Set(["app", "www", "api", "admin", "book", "static"]);

/**
 * Hosts that can never belong to a tenant. Without this, `localhost` in
 * development (and any bare IP in production) falls into the custom-domain
 * branch and the platform's own pages 404.
 */
const PLATFORM_HOSTS = /^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3})$/;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

/** The sentinel slug segment meaning "resolve this tenant by Host header". */
export const HOST_SLUG = "~host";

function subdomainOf(host: string): string | null {
  const bare = host.split(":")[0].toLowerCase();
  const root = ROOT_DOMAIN.split(":")[0].toLowerCase();
  if (bare === root) return null;
  if (!bare.endsWith(`.${root}`)) return null;
  const label = bare.slice(0, -(root.length + 1));
  return label.includes(".") ? null : label;
}

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const { pathname } = url;

  // Never rewrite framework, API or asset traffic.
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/console") ||
    pathname.startsWith("/book") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const label = subdomainOf(host);

  // app.clinicdesk.in -> the practitioner console
  if (label === "app") {
    const rewritten = new URL(url);
    rewritten.pathname = `/console${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewritten);
  }

  // heal.clinicdesk.in -> that clinic's public booking site
  if (label && !RESERVED_SUBDOMAINS.has(label) && SLUG_PATTERN.test(label)) {
    const rewritten = new URL(url);
    rewritten.pathname = `/book/${label}${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(rewritten);
  }

  // Unknown host: either the platform's own root domain, or a tenant custom
  // domain such as book.healphysiotherapy.in. The app layer decides.
  const bareHost = host.split(":")[0].toLowerCase();
  const rootHost = ROOT_DOMAIN.split(":")[0].toLowerCase();
  if (
    bareHost &&
    bareHost !== rootHost &&
    !PLATFORM_HOSTS.test(bareHost) &&
    !RESERVED_SUBDOMAINS.has(label ?? "")
  ) {
    const rewritten = new URL(url);
    rewritten.pathname = `/book/${HOST_SLUG}${pathname === "/" ? "" : pathname}`;
    const response = NextResponse.rewrite(rewritten);
    response.headers.set("x-clinic-hostname", bareHost);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
