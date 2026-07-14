import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALLOWED: Record<string, { contentType: string; binary?: boolean }> = {
  "loopdesk-customer-dashboard.js": { contentType: "application/javascript; charset=utf-8" },
  "loopdesk-customer-dashboard.css": { contentType: "text/css; charset=utf-8" },
  "megaska-auth.js": { contentType: "application/javascript; charset=utf-8" },
  "megaska-otp.js": { contentType: "application/javascript; charset=utf-8" },
  "megaska-otp.css": { contentType: "text/css; charset=utf-8" },
  "megaska_logo.png": { contentType: "image/png", binary: true },
};

export async function GET(_request: NextRequest, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const name = basename(asset || "");
  const definition = ALLOWED[name];
  if (!definition) return new NextResponse("Not found", { status: 404 });

  const file = await readFile(join(process.cwd(), "extensions", "megaska-otp", "assets", name));
  const body = definition.binary ? file : file.toString("utf8");

  return new NextResponse(body, {
    headers: {
      "Content-Type": definition.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const dynamic = "force-dynamic";
