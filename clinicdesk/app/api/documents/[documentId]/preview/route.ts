import { requireStaff } from "@/lib/session";
import { renderDocument, DocumentError } from "@/services/documents/documents";

/**
 * Renders the document as standalone HTML for the editor's live preview iframe.
 *
 * Served same-origin behind the staff session, and never cached — a stale
 * preview of a clinical document is worse than no preview.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const { documentId } = await params;
  const session = await requireStaff();

  try {
    const { html } = await renderDocument(session.clinicId, documentId);
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    const message = error instanceof DocumentError ? error.message : "Preview unavailable.";
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:24px;color:#46515f">${message}</body>`,
      { status: error instanceof DocumentError ? 400 : 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
}
