"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentData, Measure, TemplateField } from "@/services/documents/template";
import {
  finalise,
  generateDraft,
  issueCorrection,
  saveDocument,
  share,
} from "@/app/console/(app)/documents/[documentId]/actions";

type SaveState = "idle" | "saving" | "saved" | "error";

export type EditorProps = {
  documentId: string;
  title: string;
  status: "DRAFT" | "FINALISED" | "SUPERSEDED";
  documentNo: string | null;
  fields: TemplateField[];
  initialData: DocumentData;
  patientName: string;
  hasEpisode: boolean;
  aiEnabled: boolean;
};

const AUTOSAVE_MS = 900;

function asString(value: DocumentData[string]): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    if (typeof value[0] === "object") return "";
    return (value as string[]).join("\n");
  }
  return String(value);
}

function asMeasures(value: DocumentData[string]): Measure[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 0 && typeof value[0] === "object") return value as Measure[];
  return [];
}

/**
 * Split-screen editor: structured fields on the left, the real A4 page on the
 * right. She is writing something she will print, so she should be looking at
 * the page while she writes it.
 *
 * Autosave is debounced and the preview refreshes from the saved state — the
 * preview is therefore always a render of what is actually stored, never of
 * unsaved local state that could differ from the PDF.
 */
export function DocumentEditor(props: EditorProps) {
  const router = useRouter();
  const [data, setData] = useState<DocumentData>(props.initialData);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [previewVersion, setPreviewVersion] = useState(0);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readOnly = props.status !== "DRAFT";

  const flush = useCallback(
    async (next: DocumentData) => {
      setSaveState("saving");
      const result = await saveDocument(props.documentId, next);
      if (result.ok) {
        setSaveState("saved");
        setPreviewVersion((version) => version + 1);
      } else {
        setSaveState("error");
        setNotice({ tone: "bad", text: result.error });
      }
    },
    [props.documentId],
  );

  const update = useCallback(
    (key: string, value: string | string[] | Measure[]) => {
      if (readOnly) return;
      setData((previous) => {
        const next = { ...previous, [key]: value };
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void flush(next), AUTOSAVE_MS);
        return next;
      });
    },
    [flush, readOnly],
  );

  // A half-typed discharge summary lost to a closed tab is unacceptable.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (saveState === "saving" || timer.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const previewSrc = useMemo(
    () => `/api/documents/${props.documentId}/preview?v=${previewVersion}`,
    [props.documentId, previewVersion],
  );

  async function runFinalise() {
    if (timer.current) {
      clearTimeout(timer.current);
      await flush(data);
    }
    setBusy("finalise");
    const result = await finalise(props.documentId);
    setBusy(null);
    if (result.ok) {
      setNotice({ tone: "good", text: result.message ?? "Finalised." });
      router.refresh();
    } else {
      setNotice({ tone: "bad", text: result.error });
    }
  }

  async function runDraft() {
    setBusy("draft");
    const result = await generateDraft(props.documentId);
    setBusy(null);
    if (result.ok && result.data) {
      setData(result.data);
      setPreviewVersion((v) => v + 1);
      setNotice({ tone: "good", text: result.message ?? "Draft written in." });
    } else if (!result.ok) {
      setNotice({ tone: "bad", text: result.error });
    }
  }

  async function runShare() {
    setBusy("share");
    const result = await share(props.documentId);
    setBusy(null);
    if (result.ok && result.url) {
      setShareUrl(result.url);
      setNotice({ tone: "good", text: "Share link created — valid for 30 days." });
    } else if (!result.ok) {
      setNotice({ tone: "bad", text: result.error });
    }
  }

  async function runCorrection() {
    setBusy("correct");
    const result = await issueCorrection(props.documentId);
    setBusy(null);
    if (result.ok && result.id) router.push(`/console/documents/${result.id}`);
    else if (!result.ok) setNotice({ tone: "bad", text: result.error });
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,460px)_1fr]">
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-bold">{props.title}</h1>
          <p className="text-sm text-ink-soft">
            {props.patientName}
            {props.documentNo && ` · ${props.documentNo}`}
          </p>
        </header>

        {readOnly && (
          <p className="rounded-lg bg-surface-sunk px-3 py-2 text-sm text-ink-soft">
            This document is {props.status.toLowerCase()} and can no longer be edited.
            Issue a correction to change it — the original stays on file.
          </p>
        )}

        {notice && (
          <p
            role="status"
            className={`rounded-lg px-3 py-2 text-sm ${
              notice.tone === "good" ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
            }`}
          >
            {notice.text}
          </p>
        )}

        {shareUrl && (
          <div className="card p-3">
            <div className="field-label">Share link</div>
            <input className="input font-mono text-xs" readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}

        {!readOnly && props.aiEnabled && (
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={runDraft}
            disabled={busy !== null || !props.hasEpisode}
            title={props.hasEpisode ? undefined : "Link this document to an episode of care first."}
          >
            {busy === "draft" ? "Drafting from the visit notes…" : "Draft from visit notes"}
          </button>
        )}

        <div className="space-y-4">
          {props.fields.map((field) => (
            <FieldInput
              key={field.key}
              field={field}
              value={data[field.key]}
              readOnly={readOnly}
              onChange={update}
            />
          ))}
        </div>

        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center gap-2 border-t border-line bg-surface-sunk px-1 py-3">
          <span className="text-xs text-ink-faint">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && "Not saved"}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <a
              className="btn btn-secondary"
              href={`/api/documents/${props.documentId}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              Print / PDF
            </a>
            {readOnly ? (
              <>
                <button type="button" className="btn btn-secondary" onClick={runShare} disabled={busy !== null}>
                  Share with patient
                </button>
                {props.status === "FINALISED" && (
                  <button type="button" className="btn btn-secondary" onClick={runCorrection} disabled={busy !== null}>
                    Issue correction
                  </button>
                )}
              </>
            ) : (
              <button type="button" className="btn btn-primary" onClick={runFinalise} disabled={busy !== null}>
                {busy === "finalise" ? "Finalising…" : "Finalise & number"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="hidden xl:block">
        <div className="sticky top-16">
          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-faint">
            Preview — A4, on your letterhead
          </div>
          <div className="overflow-hidden rounded-[10px] border border-line bg-surface-sunk p-4">
            <iframe
              key={previewVersion}
              src={previewSrc}
              title="Document preview"
              className="page-preview h-[297mm] w-[210mm] origin-top"
              style={{ transform: "scale(0.62)", marginBottom: "-113mm" }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldInput({
  field,
  value,
  readOnly,
  onChange,
}: {
  field: TemplateField;
  value: DocumentData[string];
  readOnly: boolean;
  onChange: (key: string, value: string | string[] | Measure[]) => void;
}) {
  const id = `field-${field.key}`;

  if (field.kind === "measures") {
    return (
      <MeasuresInput
        id={id}
        field={field}
        rows={asMeasures(value)}
        readOnly={readOnly}
        onChange={(rows) => onChange(field.key, rows)}
      />
    );
  }

  return (
    <div>
      <label className="field-label" htmlFor={id}>
        {field.label}
        {field.required && <span className="ml-1 text-danger">*</span>}
      </label>

      {field.kind === "textarea" ? (
        <textarea
          id={id}
          className="textarea"
          readOnly={readOnly}
          value={asString(value)}
          placeholder={field.hint}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      ) : field.kind === "list" ? (
        <textarea
          id={id}
          className="textarea"
          readOnly={readOnly}
          value={asString(value)}
          placeholder={field.hint ?? "One per line"}
          onChange={(event) =>
            onChange(
              field.key,
              event.target.value.split("\n").map((line) => line.trim()).filter(Boolean),
            )
          }
        />
      ) : (
        <input
          id={id}
          className="input"
          readOnly={readOnly}
          type={field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text"}
          value={asString(value)}
          placeholder={field.hint}
          onChange={(event) => onChange(field.key, event.target.value)}
        />
      )}

      {field.hint && field.kind !== "list" && (
        <p className="mt-1 text-xs text-ink-faint">{field.hint}</p>
      )}
    </div>
  );
}

/**
 * Outcome measures are the one thing a discharge summary can show rather than
 * assert — "NPRS 8 → 2" is the sentence a referring doctor actually reads.
 */
function MeasuresInput({
  id,
  field,
  rows,
  readOnly,
  onChange,
}: {
  id: string;
  field: TemplateField;
  rows: Measure[];
  readOnly: boolean;
  onChange: (rows: Measure[]) => void;
}) {
  function patch(index: number, patchValue: Partial<Measure>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));
  }

  return (
    <div>
      <span className="field-label" id={id}>
        {field.label}
      </span>
      <div className="space-y-2" role="group" aria-labelledby={id}>
        {rows.map((row, index) => (
          <div key={index} className="grid grid-cols-[1fr_72px_72px_32px] gap-1.5">
            <input
              className="input"
              placeholder="Measure"
              readOnly={readOnly}
              value={row.label ?? ""}
              onChange={(event) => patch(index, { label: event.target.value, code: row.code ?? event.target.value })}
            />
            <input
              className="input text-center"
              placeholder="Start"
              readOnly={readOnly}
              value={row.initial ?? ""}
              onChange={(event) => patch(index, { initial: event.target.value })}
            />
            <input
              className="input text-center"
              placeholder="End"
              readOnly={readOnly}
              value={row.current ?? ""}
              onChange={(event) => patch(index, { current: event.target.value })}
            />
            {!readOnly && (
              <button
                type="button"
                className="btn btn-ghost min-h-0 px-0"
                aria-label={`Remove ${row.label || "measure"}`}
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <button
          type="button"
          className="btn btn-ghost mt-1 min-h-0 px-0 text-sm"
          onClick={() => onChange([...rows, { code: "", label: "", initial: "", current: "" }])}
        >
          + Add measure
        </button>
      )}
    </div>
  );
}
