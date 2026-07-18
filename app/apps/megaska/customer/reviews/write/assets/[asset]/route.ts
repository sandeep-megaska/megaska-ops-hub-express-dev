import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";

const TYPES: Record<string, string> = {
  "loopdesk-product-reviews.js": "application/javascript; charset=utf-8",
  "loopdesk-product-reviews.css": "text/css; charset=utf-8",
};

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ asset: string }> }) {
  const { asset } = await params;
  if (!TYPES[asset]) return new Response("Not found", { status: 404 });
  const file = path.join(process.cwd(), "extensions", "megaska-otp", "assets", asset);
  return new Response(await readFile(file, "utf8"), { headers: { "content-type": TYPES[asset], "cache-control": "public, max-age=300" } });
}
