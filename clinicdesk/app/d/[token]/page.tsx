import { notFound } from "next/navigation";
import { resolveShareToken } from "@/services/documents/share";
import { renderDocument } from "@/services/documents/documents";

export const metadata = {
  title: "Your document",
  robots: { index: false, follow: false },
};

/**
 * The patient-facing view of a shared document.
 *
 * No login: the link itself is the credential, which is why it expires, is
 * individually revocable, and is stored only as a hash. The page is rendered
 * server-side and framed so the patient sees exactly the printed page.
 */
export default async function SharedDocumentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const document = await resolveShareToken(token);
  if (!document) notFound();

  const { doc } = await renderDocument(document.clinicId, document.id);

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-4">
        <h1 className="text-lg font-bold">{doc.title}</h1>
        <p className="text-sm text-ink-soft">
          {doc.clinic.name}
          {doc.documentNo && ` · ${doc.documentNo}`}
        </p>
      </header>

      <div className="overflow-hidden rounded-[10px] border border-line bg-surface">
        <iframe
          src={`/d/${encodeURIComponent(token)}/view`}
          title={doc.title}
          className="h-[80vh] w-full"
        />
      </div>

      <p className="mt-4 text-xs text-ink-faint">
        This link expires. If it has stopped working, contact {doc.clinic.name}
        {doc.clinic.publicPhone ? ` on ${doc.clinic.publicPhone}` : ""}.
      </p>
    </main>
  );
}
