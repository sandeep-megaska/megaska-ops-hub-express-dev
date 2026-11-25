// Browsers attach Basic auth credentials to any request to this site, even
// one started by another website. Admin API calls must therefore carry a
// header that a cross-site form cannot set.
export const ADMIN_HEADER = "x-megaska-admin";

export function isAdminRequest(request: Request): boolean {
  return request.headers.get(ADMIN_HEADER) === "1";
}

export function forbidden() {
  return Response.json({ ok: false, error: "Missing admin header" }, { status: 403 });
}
