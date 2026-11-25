import { forbidden, isAdminRequest } from "@/lib/admin.ts";
import { createApiClient, revokeApiClient, SCOPES, type Scope } from "@/lib/channel/keys.ts";
import { ensureStore } from "@/lib/store.ts";

// POST {"name": "Browntape", "scopes": [...]} -> the new key, shown once.
// DELETE {"id": "..."} -> revoke.
export async function POST(request: Request) {
  if (!isAdminRequest(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { name?: string; scopes?: string[] };
  const name = body.name?.trim();
  if (!name || !/^[\w .-]{2,40}$/.test(name)) {
    return Response.json({ ok: false, error: "Name: 2-40 letters, digits, spaces, dots or dashes" }, { status: 400 });
  }
  const scopes = (body.scopes?.length ? body.scopes : [...SCOPES]) as Scope[];
  try {
    const storeId = await ensureStore();
    const { key, prefix } = await createApiClient(storeId, name, scopes);
    return Response.json({ ok: true, key, prefix, scopes });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /duplicate key/.test(message) ? 409 : 400;
    return Response.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  if (!isAdminRequest(request)) return forbidden();
  const body = (await request.json().catch(() => ({}))) as { id?: string };
  if (!body.id) return Response.json({ ok: false, error: "id is required" }, { status: 400 });
  await revokeApiClient(await ensureStore(), body.id);
  return Response.json({ ok: true });
}
