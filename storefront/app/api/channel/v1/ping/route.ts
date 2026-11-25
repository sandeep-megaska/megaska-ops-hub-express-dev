import { apiError, requestIdOf } from "@/lib/channel/http.ts";
import { authenticate } from "@/lib/channel/keys.ts";

// Connection test for integrators: confirms the key works and shows its scopes.
export async function GET(request: Request) {
  const requestId = requestIdOf(request);
  const client = await authenticate(request.headers.get("authorization"));
  if (!client) return apiError(401, "unauthorized", "Missing or invalid API key (Authorization: Bearer msk_...)", requestId);
  return Response.json({ ok: true, client: client.name, scopes: client.scopes, request_id: requestId });
}
