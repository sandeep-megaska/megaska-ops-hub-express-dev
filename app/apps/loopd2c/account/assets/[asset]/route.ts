import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, "extensions", "megaska-otp", "assets");
const ALLOWED: Record<string, string> = {
  "loopd2c-auth.js": "application/javascript; charset=utf-8",
  "loopd2c-otp.js": "application/javascript; charset=utf-8",
  "loopd2c-otp.css": "text/css; charset=utf-8",
  "loopd2c_logo.png": "image/png",
  "loopdesk-customer-dashboard.js": "application/javascript; charset=utf-8",
  "loopdesk-customer-dashboard.css": "text/css; charset=utf-8",
  "loopdesk-account-launcher.js": "application/javascript; charset=utf-8",
  "loopdesk-account-launcher.css": "text/css; charset=utf-8",
};

function safeAssetName(value: string) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === value && /^[a-zA-Z0-9._-]+$/.test(value) && ALLOWED[value] ? value : "";
  } catch {
    return "";
  }
}

export async function GET(_request: NextRequest, context: { params: Promise<{ asset: string }> }) {
  const { asset } = await context.params;
  const name = safeAssetName(asset);
  if (!name) return NextResponse.json({ ok: false, error: "Asset not found" }, { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  const filePath = path.join(ASSETS_DIR, name);
  if (!filePath.startsWith(ASSETS_DIR + path.sep)) return NextResponse.json({ ok: false, error: "Asset not found" }, { status: 404 });
  try {
    const body = await readFile(filePath);
    return new NextResponse(body, { headers: { "Content-Type": ALLOWED[name], "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return NextResponse.json({ ok: false, error: "Asset not found" }, { status: 404, headers: { "X-Content-Type-Options": "nosniff" } });
  }
}

export const dynamic = "force-dynamic";
