import { resolveShareToken } from "@/services/documents/share";
import { renderDocument } from "@/services/documents/documents";

/** The rendered page itself, for the viewer iframe. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const document = await resolveShareToken(token);
  if (!document) return new Response("Not found", { status: 404 });

  const { html } = await renderDocument(document.clinicId, document.id);
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
