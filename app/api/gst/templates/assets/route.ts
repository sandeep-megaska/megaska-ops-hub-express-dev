import { NextRequest, NextResponse } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

const MAX_SIZE_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/avif", "image/svg+xml"]);
const ALLOWED_SLOTS = new Set(["header", "footer"]);

function extensionFor(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/avif") return "avif";
  if (mimeType === "image/svg+xml") return "svg";
  return "bin";
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const slot = String(formData.get("slot") || "").trim().toLowerCase();
  const file = formData.get("file");

  if (!ALLOWED_SLOTS.has(slot)) return NextResponse.json({ ok: false, error: "slot must be header or footer" }, { status: 400 });
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
  if (!ALLOWED_MIME_TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "Unsupported file type" }, { status: 400 });
  if (file.size > MAX_SIZE_BYTES) return NextResponse.json({ ok: false, error: "File size exceeds 2MB limit" }, { status: 400 });

  const ext = extensionFor(file.type);
  const stamp = Date.now();
  const name = `${slot}-${stamp}.${ext}`;
  const relativeUrl = `/uploads/gst-templates/${name}`;
  const targetPath = path.join(process.cwd(), "public", "uploads", "gst-templates", name);

  await mkdir(path.dirname(targetPath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, buffer);

  return NextResponse.json({ ok: true, url: relativeUrl }, { status: 200 });
}
