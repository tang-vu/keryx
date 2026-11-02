"use client";

import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_EVIDENCE_DRAFT_BACKUP_BYTES, prepareEvidenceDraftRestore, type EvidenceDraftRestore as PreparedRestore } from "@/lib/research/evidence-draft-restore";
import { evidenceDraftCopyText } from "@/lib/research/evidence-draft-copy";
import type { EvidenceDraftRequest } from "@/lib/research/evidence-draft";
import { evidenceDraftRestoreCopy as english } from "@/locales/en/evidence-draft-restore";
import { UiText, useUiCopy } from "@/lib/i18n/ui-copy";
import { englishUiCopy, UiCopyContext } from "@/lib/i18n/ui-copy-context";
import { localeDirection } from "@/lib/i18n/locales";

const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";

export function EvidenceDraftRestore({ context, onRestore, onSave, canSave }: {
  context: object;
  onRestore: (request: EvidenceDraftRequest, expectedContext: object) => boolean;
  onSave: () => void;
  canSave: boolean;
}) {
  const copy = useUiCopy("evidence-draft-restore", english);
  const { locale } = useContext(UiCopyContext) ?? englishUiCopy;
  const summaryLanguage = copy.summary === english.summary ? "en" : locale;
  const [pending, setPending] = useState<{ prepared: PreparedRestore; context: object; filename: string }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"" | "stale" | "refused" | "restored" | "cancelled">("");
  const attempt = useRef(0), latestContext = useRef(context);
  useLayoutEffect(() => { latestContext.current = context; }, [context]);
  useEffect(() => () => { attempt.current++; }, []);
  const stale = !!pending && pending.context !== context;

  return <section aria-label={copy.heading} className="min-w-0 border border-line bg-paper p-5">
    <h2 className="font-display text-xl"><UiText source={english.heading} namespaces={["evidence-draft-restore"]} /></h2>
    <p className="mt-2 font-serif text-sm leading-relaxed text-ink-2"><UiText source={english.guidance} namespaces={["evidence-draft-restore"]} /></p>
    <label className="mt-4 block font-mono text-xs text-ink-2"><UiText source={english.file} namespaces={["evidence-draft-restore"]} />
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
          if (expectedContext !== latestContext.current) { setMessage("stale"); return; }
          setPending({ prepared, context: expectedContext, filename: file.name });
        } catch { if (token === attempt.current) setMessage("refused"); }
        finally { if (token === attempt.current) setBusy(false); }
      }} />
    </label>
    {pending && <div className="mt-4 min-w-0 border-t border-line pt-4" aria-label={copy.preview}>
      <h3 className="break-words font-display text-lg">{pending.prepared.summary.title
        ? <bdi lang="und" dir="auto" translate="no">{pending.prepared.summary.title}</bdi>
        : <UiText source={english.untitled} namespaces={["evidence-draft-restore"]} />}</h3>
      <p className="mt-1 break-all font-mono text-xs text-ink-3"><bdi lang="und" dir="auto" translate="no">{pending.filename}</bdi></p>
      <p className="mt-2 font-serif text-sm text-ink-2"><span lang={summaryLanguage} dir={localeDirection(summaryLanguage)}>{evidenceDraftCopyText(copy.summary, pending.prepared.summary)}</span></p>
      {pending.prepared.summary.passage && <p className="mt-3 whitespace-pre-wrap break-words font-serif text-sm text-ink-2" aria-label={copy.passage}><bdi lang="und" dir="auto" translate="no">{pending.prepared.summary.passage}</bdi></p>}
      <p className="mt-3 font-serif text-sm text-seal"><UiText source={english.replace} namespaces={["evidence-draft-restore"]} /></p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={button} disabled={stale} onClick={() => {
          if (pending.context !== latestContext.current || !onRestore(pending.prepared.request, pending.context)) { setMessage("stale"); return; }
          attempt.current++; setPending(undefined); setMessage("restored");
        }}><UiText source={english.restore} namespaces={["evidence-draft-restore"]} /></button>
        <button type="button" className={button} disabled={!canSave} onClick={onSave}><UiText source={english.save} namespaces={["evidence-draft-restore"]} /></button>
      </div>
    </div>}
    {(busy || pending) && <button type="button" className={`${button} mt-3`} onClick={() => {
      attempt.current++; setBusy(false); setPending(undefined); setMessage("cancelled");
    }}><UiText source={english.cancel} namespaces={["evidence-draft-restore"]} /></button>}
    <p role="status" aria-live="polite" className="mt-3 font-serif text-sm text-seal"><UiText source={busy ? english.reading : stale ? english.stale : message ? english[message] : ""} namespaces={["evidence-draft-restore"]} /></p>
  </section>;
}
