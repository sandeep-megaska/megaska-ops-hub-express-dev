import bundledCollections from "@/data/megaska-collections.json";
import { revalidateTag } from "next/cache";
import { forbidden, isAdminRequest } from "@/lib/admin.ts";
import { importCollectionsJson, importProductsCsv, importRedirectsCsv } from "@/lib/import/run.ts";
import { CATALOG_TAG, REDIRECTS_TAG } from "@/lib/catalog/tags.ts";

export const maxDuration = 120;

const MAX_BYTES = 4 * 1024 * 1024; // Vercel's request body limit is 4.5 MB

// POST multipart/form-data with "file" (and "mode" for products).
// kind: products | redirects | collections. collections without a file loads
// the bundled data/megaska-collections.json.
export async function POST(request: Request, { params }: RouteContext<"/api/admin/import/[kind]">) {
  if (!isAdminRequest(request)) return forbidden();
  const { kind } = await params;
  const form = await request.formData();
  const file = form.get("file");
  let text: string | null = null;
  let fileName: string | undefined;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return Response.json({ ok: false, error: "File is larger than 4 MB" }, { status: 413 });
    text = await file.text();
    fileName = file.name;
  }

  let outcome;
  switch (kind) {
    case "products": {
      if (!text) return Response.json({ ok: false, error: "Choose the products CSV file" }, { status: 400 });
      const mode = form.get("mode") === "full" ? "full" : "partial";
      outcome = await importProductsCsv(text, { mode, fileName });
      break;
    }
    case "redirects":
      if (!text) return Response.json({ ok: false, error: "Choose the redirects CSV file" }, { status: 400 });
      outcome = await importRedirectsCsv(text, fileName);
      break;
    case "collections": {
      let json: unknown = bundledCollections;
      if (text) {
        try {
          json = JSON.parse(text);
        } catch {
          return Response.json({ ok: false, error: "Collections file is not valid JSON" }, { status: 400 });
        }
      }
      outcome = await importCollectionsJson(json, fileName ?? "data/megaska-collections.json");
      break;
    }
    default:
      return Response.json({ ok: false, error: `Unknown import kind ${kind}` }, { status: 404 });
  }

  if (outcome.ok) {
    revalidateTag(CATALOG_TAG, { expire: 0 });
    if (kind === "redirects") revalidateTag(REDIRECTS_TAG, { expire: 0 });
  }
  return Response.json(outcome, { status: outcome.ok ? 200 : 422 });
}
