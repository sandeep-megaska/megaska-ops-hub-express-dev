import { revalidateTag } from "next/cache";
import { env } from "@/lib/env.ts";
import { runFullSync } from "@/lib/sync/full-sync.ts";
import { CATALOG_TAG, REDIRECTS_TAG } from "@/lib/catalog/tags.ts";

export const maxDuration = 300;

// Nightly reconciliation (vercel.json). Vercel Cron sends
// "Authorization: Bearer $CRON_SECRET"; you can call it the same way by hand.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${env.cronSecret()}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const stats = await runFullSync({ log: (msg) => console.log(`[full-sync] ${msg}`) });
    revalidateTag(CATALOG_TAG, "max");
    revalidateTag(REDIRECTS_TAG, "max");
    return Response.json({ ok: true, stats });
  } catch (error) {
    console.error("[full-sync] failed", error);
    return Response.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
