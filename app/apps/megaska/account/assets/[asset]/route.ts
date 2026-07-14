import { readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ALLOWED: Record<string, string> = {
  "loopdesk-customer-dashboard.js": "application/javascript; charset=utf-8",
  "loopdesk-customer-dashboard.css": "text/css; charset=utf-8",
  "megaska-auth.js": "application/javascript; charset=utf-8",
  "megaska-otp.js": "application/javascript; charset=utf-8",
  "megaska-otp.css": "text/css; charset=utf-8",
};

export async function GET(_request: NextRequest, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const name = basename(asset || "");
  const contentType = ALLOWED[name];
  if (!contentType) return new NextResponse("Not found", { status: 404 });
  const body = await readFile(join(process.cwd(), "extensions", "megaska-otp", "assets", name), "utf8");
  return new NextResponse(body, { headers: { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}

export const dynamic = "force-dynamic";
