import { randomUUID } from "node:crypto";
import { authenticate, type ApiClient, type Scope } from "./keys.ts";

export function requestIdOf(request: Request): string {
  const given = request.headers.get("x-request-id")?.trim();
  return given && given.length <= 100 ? given : randomUUID();
}

export function apiError(status: number, code: string, message: string, requestId: string, details?: string[]) {
  return Response.json(
    { error: { code, message, ...(details?.length ? { details } : {}) }, request_id: requestId },
    { status, headers: { "x-request-id": requestId } },
  );
}

/** The calling client, or an error response (401 no/bad key, 403 missing scope). */
export async function requireClient(request: Request, scope: Scope, requestId: string): Promise<ApiClient | Response> {
  const client = await authenticate(request.headers.get("authorization"));
  if (!client) return apiError(401, "unauthorized", "Missing or invalid API key (Authorization: Bearer msk_...)", requestId);
  if (!client.scopes.includes(scope)) return apiError(403, "forbidden", `This key lacks the ${scope} scope`, requestId);
  return client;
}

export function intParam(url: URL, name: string, fallback: number, max: number): number {
  const n = Number(url.searchParams.get(name) ?? fallback);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}
