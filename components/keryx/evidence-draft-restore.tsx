"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_EVIDENCE_DRAFT_BACKUP_BYTES, prepareEvidenceDraftRestore, type EvidenceDraftRestore as PreparedRestore } from "@/lib/research/evidence-draft-restore";
import { evidenceDraftCopyText } from "@/lib/research/evidence-draft-copy";
import type { EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import { evidenceDraftRestoreCopy as english } from "@/locales/en/evidence-draft-restore";
import { useUiCopy } from "@/lib/i18n/ui-copy";

const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";

export function EvidenceDraftRestore({ context, onRestore, onSave, canSave }: {
  context: object;
  onRestore: (request: EvidenceDraftRequest, expectedContext: object) => boolean;
  onSave: () => void;
  canSave: boolean;
}) {
  const copy = useUiCopy("evidence-draft-restore", english);
  const [pending, setPending] = useState<{ prepared: PreparedRestore; context: object; filename: string }>();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const attempt = useRef(0), latestContext = useRef(context);
  useLayoutEffect(() => { latestContext.current = context; }, [context]);
  useEffect(() => () => { attempt.current++; }, []);
  const stale = !!pending && pending.context !== context;

  return <section aria-label={copy.heading} className="min-w-0 border border-line bg-paper p-5">
    <h2 className="font-display text-xl">{copy.heading}</h2>
    <p className="mt-2 font-serif text-sm leading-relaxed text-ink-2">{copy.guidance}</p>
    <label className="mt-4 block font-mono text-xs text-ink-2">{copy.file}
      <input type="file" accept=".json,application/json" className="mt-2 block min-h-11 w-full min-w-0 text-sm" onChange={async event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        const token = ++attempt.current, expectedContext = latestContext.current;
        setPending(undefined); setMessage(""); setBusy(!!file);
        if (!file) return;
        try {
          if (file.size > MAX_EVIDENCE_DRAFT_BACKUP_BYTES) throw new Error();
          const bytes = await file.arrayBuffer();
          if (token !== attempt.current) return;
          if (bytes.byteLength > MAX_EVIDENCE_DRAFT_BACKUP_BYTES) throw new Error();
          const prepared = prepareEvidenceDraftRestore(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
          if (token !== attempt.current) return;
          if (expectedContext !== latestContext.current) { setMessage(copy.stale); return; }
          setPending({ prepared, context: expectedContext, filename: file.name });
        } catch { if (token === attempt.current) setMessage(copy.refused); }
        finally { if (token === attempt.current) setBusy(false); }
      }} />
    </label>
    {pending && <div className="mt-4 min-w-0 border-t border-line pt-4" aria-label={copy.preview}>
      <h3 className="break-words font-display text-lg">{pending.prepared.summary.title || copy.untitled}</h3>
      <p className="mt-1 break-all font-mono text-xs text-ink-3">{pending.filename}</p>
      <p className="mt-2 font-serif text-sm text-ink-2">{evidenceDraftCopyText(copy.summary, pending.prepared.summary)}</p>
      {pending.prepared.summary.passage && <p className="mt-3 whitespace-pre-wrap break-words font-serif text-sm text-ink-2" aria-label={copy.passage}>{pending.prepared.summary.passage}</p>}
      <p className="mt-3 font-serif text-sm text-seal">{copy.replace}</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={button} disabled={stale} onClick={() => {
          if (pending.context !== latestContext.current || !onRestore(pending.prepared.request, pending.context)) { setMessage(copy.stale); return; }
          attempt.current++; setPending(undefined); setMessage(copy.restored);
        }}>{copy.restore}</button>
        <button type="button" className={button} disabled={!canSave} onClick={onSave}>{copy.save}</button>
      </div>
    </div>}
    {(busy || pending) && <button type="button" className={`${button} mt-3`} onClick={() => {
      attempt.current++; setBusy(false); setPending(undefined); setMessage(copy.cancelled);
    }}>{copy.cancel}</button>}
    <p role="status" aria-live="polite" className="mt-3 font-serif text-sm text-seal">{busy ? copy.reading : stale ? copy.stale : message}</p>
  </section>;
}
