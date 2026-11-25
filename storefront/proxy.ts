import { NextResponse, type NextRequest } from "next/server";

// HTTP Basic auth for the admin area: user "admin", password ADMIN_PASSWORD.
// With no ADMIN_PASSWORD set, the admin area is switched off.

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function proxy(request: NextRequest) {
  const password = process.env.ADMIN_PASSWORD?.trim();
  if (!password) return new NextResponse("Admin is disabled (set ADMIN_PASSWORD).", { status: 404 });

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(":");
    if (sep > 0 && decoded.slice(0, sep) === "admin" && safeEqual(decoded.slice(sep + 1), password)) {
      return NextResponse.next();
    }
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Megaska storefront admin", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
