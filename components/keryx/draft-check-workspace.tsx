"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { useUiMessages } from "@/lib/i18n/ui-copy";
import { buildDraftCheck, DRAFT_CHECK_NOTICE, MAX_DRAFT_CHECK_BYTES, MAX_DRAFT_SOURCE_CHARACTERS, type DraftCheck, type DraftCheckRequest } from "@/lib/research/draft-check";
import { detectDraftReferenceFormat, parseDraftReferences, type DraftReference } from "@/lib/research/draft-check-references";
import { draftCheckCopy as copy, draftCheckCopyText as copyText } from "@/lib/research/draft-check-copy";
import { clearSavedDraftCheck, readDraftCheckFile, restoreDraftCheck, saveDraftCheck, DRAFT_CHECK_STORAGE_KEY, type DraftCheckLifetime } from "@/lib/research/draft-check-retention";

const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const quote = "mt-2 whitespace-pre-wrap border-l-2 border-seal pl-3 font-serif text-sm text-ink";
interface SourceEditor { text: string; complete: boolean; identity?: DraftCheckRequest["sources"][number]["identity"] }
const claimLabel = (id: string) => copyText(copy.flags.claim, { number: id.replace("claim", "") });

/** Presentation of one completed check. Excerpts are shown exactly as returned. */
export function DraftCheckResults({ result }: { result: DraftCheck }) {
  return <section aria-label={copy.results.label} className="border border-line bg-paper p-5">
    <h2 className="font-display text-xl text-ink">{copy.results.heading}</h2>
    <p className="mt-2 font-mono text-xs text-ink-2">{copyText(copy.results.summary, result.summary)}</p>
    {result.claims.map(claim => <article key={claim.id} className="mt-5 border-t border-line pt-4">
      <h3 className="font-mono text-xs text-ink-3">{claimLabel(claim.id)}</h3>
      <p className="mt-1 whitespace-pre-wrap font-serif text-sm text-ink">{claim.text}</p>
      <p className="mt-2 font-mono text-xs text-seal">{copy.results.verdicts[claim.verdict]}</p>
      {claim.notCheckedReason && <p className="mt-1 font-serif text-xs text-ink-3">{copy.results.notChecked[claim.notCheckedReason]}</p>}
      {claim.citations.map(citation => <div key={`${citation.token}:${citation.reference ?? ""}`} className="mt-3 pl-3">
        <p className="break-words font-mono text-xs text-ink-2">{citation.reference
          ? copyText(copy.results.citation, { token: citation.token, reference: citation.reference }) : copyText(copy.results.citationUnbound, { token: citation.token })}
          {" · "}{copy.results.verdicts[citation.verdict]}</p>
        {citation.unavailableReason && <p className="mt-1 font-serif text-sm text-ink-2">{copy.results.unavailable[citation.unavailableReason]}</p>}
        {citation.excerpt && <blockquote className={quote}>{citation.excerpt.text}</blockquote>}
        {citation.sourceIdentity && <p className="mt-1 break-words font-mono text-xs text-ink-3">{copy.results.version}: {citation.sourceIdentity.contentVersion} · {citation.sourceIdentity.itemUrl}</p>}
        {citation.evidence === "no-supporting-passage-found" && <p className="mt-1 font-serif text-sm text-ink-2">{copy.results.noPassage}</p>}
        {citation.sourceTentative && <p className="mt-1 font-serif text-xs text-ink-3">{copy.results.tentative}</p>}
        {!!(citation.missingTerms?.length || citation.missingNumbers?.length) && <p className="mt-1 break-words font-serif text-xs text-ink-3">
          {copyText(citation.excerpt ? copy.results.missingTerms : copy.results.missingEverywhere, { terms: [...(citation.missingTerms ?? []), ...(citation.missingNumbers ?? [])].join(", ") })}</p>}
        {citation.closest && <>
          <p className="mt-2 font-mono text-xs text-ink-3">{copy.results.closestHeading} · {copy.results.difference[citation.closest.difference]}</p>
          <blockquote className={`${quote} border-line text-ink-2`}>{citation.closest.text}</blockquote>
        </>}
        {citation.coverage === "partial" && <p className="mt-1 font-serif text-xs text-ink-3">{copy.results.partialCoverage}</p>}
      </div>)}
      {!!claim.suggestions.length && <aside className="mt-4 border border-line p-3" aria-label={copy.results.suggestions}>
        <h4 className="font-mono text-xs text-ink-2">{copy.results.suggestions}</h4>
        <p className="mt-1 font-serif text-xs text-ink-3">{copy.results.suggestionNotice}</p>
        {claim.suggestions.map((row, index) => <div key={index} className="mt-3">
          <a className="break-words font-serif text-sm underline" href={row.url} target="_blank" rel="noopener noreferrer">{row.title}</a>
          <blockquote className={quote}>{row.excerpt.text}</blockquote>
          <p className="break-words font-mono text-xs text-ink-3">{copy.results.version}: {row.sourceIdentity.contentVersion}</p>
        </div>)}
      </aside>}
    </article>)}
    <h3 className="mt-6 font-display text-lg text-ink">{copy.flags.heading}</h3>
    {result.flags.length === 0 ? <p className="mt-2 font-serif text-sm text-ink-2">{copy.flags.none}</p> : <ul className="mt-2 list-disc pl-5 font-serif text-sm text-ink-2">
      {result.flags.map((flag, index) => <li key={index} className="break-words">{
        flag.kind === "citation-unresolved" ? copyText(copy.flags[flag.kind], { claim: claimLabel(flag.claim), token: flag.token })
          : flag.kind === "possible-different-work" ? copyText(copy.flags[flag.kind], { claim: claimLabel(flag.claim), author: flag.impliedAuthor, reference: flag.reference })
            : flag.kind === "source-different-work" ? copyText(copy.flags[flag.kind], { claim: claimLabel(flag.claim), reference: flag.reference, url: flag.observedUrl })
            : copyText(copy.flags[flag.kind], { reference: flag.reference })}</li>)}
    </ul>}
  </section>;
}

/** Tab-memory editor. The shared contract runs in this browser; no request is made. */
export function DraftCheckWorkspace() {
  const uiCopy = useUiMessages();
  const [passage, setPassage] = useState(""), [referenceText, setReferenceText] = useState("");
  const [sources, setSources] = useState<Record<string, SourceEditor>>({});
  const [suggestions, setSuggestions] = useState<DraftCheckRequest["suggestions"]>([]);
  const [chosenClaims, setChosenClaims] = useState<DraftCheckRequest["claims"]>();
  const [importedFormat, setImportedFormat] = useState<DraftCheckRequest["references"]["format"]>();
  const [lifetime, setLifetime] = useState<DraftCheckLifetime>(3600);
  const [result, setResult] = useState<DraftCheck>(), [message, setMessage] = useState("");
  const editGeneration = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = fileInput.current, cancel = () => { editGeneration.current++; };
    input?.addEventListener("cancel", cancel);
    return () => { input?.removeEventListener("cancel", cancel); cancel(); };
  }, []);
  const format = importedFormat ?? detectDraftReferenceFormat(referenceText);
  const references = useMemo<DraftReference[] | undefined>(() => {
    try { return parseDraftReferences(format, referenceText); } catch { return undefined; }
  }, [format, referenceText]);
  const edited = () => { editGeneration.current++; if (result) { setResult(undefined); setMessage(copy.workspace.stale); } else setMessage(""); };
  const source = (key: string): SourceEditor => sources[key] ?? { text: "", complete: false };
  const setSource = (key: string, changes: Partial<SourceEditor>) => { setSources(current => ({ ...current, [key]: { ...(current[key] ?? { text: "", complete: false }), ...changes,
    // Changed bytes lose the imported version binding, rather than borrowing its old identity.
    ...(changes.text !== undefined ? { identity: undefined } : {}) } })); edited(); };
  const usable = (references ?? []).filter(row => row.problem !== "duplicate-key");
  const request = (): DraftCheckRequest => ({ version: 1, scope: "private-draft-check", passage, references: { format, text: referenceText },
    sources: usable.filter(row => source(row.key).text.trim()).map(row => ({ reference: row.key,
      coverage: source(row.key).complete ? "full-text" as const : "partial" as const, text: source(row.key).text,
      ...(source(row.key).identity ? { identity: source(row.key).identity } : {}) })), suggestions,
    ...(chosenClaims ? { claims: chosenClaims } : {}) });
  const load = (packet: DraftCheckRequest) => {
    editGeneration.current++;
    setPassage(packet.passage); setReferenceText(packet.references.text);
    setImportedFormat(packet.references.format); setChosenClaims(packet.claims);
    setSources(Object.fromEntries(packet.sources.map(row => [row.reference, { text: row.text, complete: row.coverage === "full-text", identity: row.identity }])));
    setSuggestions(packet.suggestions ?? []); setResult(buildDraftCheck(packet));
  };
  const retained = async (action: () => void, isCurrent: () => boolean = () => true) => {
    try {
      if (!navigator.locks?.request) throw new Error("Storage coordination unavailable");
      await navigator.locks.request(DRAFT_CHECK_STORAGE_KEY, { mode: "exclusive" }, () => {
        if (isCurrent()) action();
      });
    } catch { if (isCurrent()) setMessage(copy.retention.unavailable); }
  };
  const run = () => {
    editGeneration.current++;
    try {
      setResult(buildDraftCheck(request())); setMessage(copy.workspace.done);
    } catch { setResult(undefined); setMessage(copy.workspace.refused); }
  };
  return <section className="mt-8 space-y-6" aria-label={copy.workspace.label}>
    <p className="font-serif text-sm leading-relaxed text-ink-2">{DRAFT_CHECK_NOTICE}</p>
    <p className="font-serif text-sm text-ink-2">{copy.workspace.privacy}</p>
    <div className="border border-line bg-paper p-5">
      <label className="font-mono text-xs text-ink-2">{copy.passage.label}
        <textarea className={field} rows={7} maxLength={12000} value={passage} onChange={event => { setPassage(event.target.value); setChosenClaims(undefined); edited(); }} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.passage.guidance}</p>
    </div>
    <div className="border border-line bg-paper p-5">
      <label className="font-mono text-xs text-ink-2">{copy.references.label}
        <textarea className={field} rows={6} maxLength={24000} spellCheck={false} value={referenceText} onChange={event => { setReferenceText(event.target.value); setImportedFormat(undefined); edited(); }} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.references.guidance}</p>
      {!!referenceText.trim() && <p className="mt-2 font-mono text-xs text-ink-3">{copyText(copy.references.format, { format: copy.references.formats[format] })}</p>}
      {!references && <p role="alert" className="mt-2 font-serif text-sm text-seal">{copy.references.unreadable}</p>}
      {!!usable.length && <>
        <h2 className="mt-5 font-display text-xl text-ink">{copy.references.heading}</h2>
        <p className="mt-2 font-serif text-sm text-ink-2">{copy.references.sourceGuidance}</p>
        {usable.map(row => <article key={row.key} className="mt-5 border-t border-line pt-4">
          <p className="break-words font-mono text-xs text-ink">{copyText(copy.references.entry, { number: row.number, key: row.key })} · {copy.references.status[row.status]}</p>
          <p className="mt-1 break-words font-serif text-sm text-ink-2">{row.title ?? row.doi ?? row.url ?? copy.references.untitled}</p>
          <label className="mt-3 block font-mono text-xs text-ink-2">{copyText(copy.references.sourceLabel, { key: row.key })}
            <textarea className={field} rows={4} maxLength={MAX_DRAFT_SOURCE_CHARACTERS} value={source(row.key).text} onChange={event => setSource(row.key, { text: event.target.value })} />
          </label>
          <label className="mt-2 flex min-h-11 items-center gap-3 font-serif text-sm text-ink-2">
            <input type="checkbox" checked={source(row.key).complete} onChange={event => setSource(row.key, { complete: event.target.checked })} />{copy.references.complete}
          </label>
        </article>)}
      </>}
    </div>
    <div className="flex flex-wrap gap-3">
      <button type="button" className={button} disabled={!passage.trim() || !references} onClick={run}>{copy.workspace.check}</button>
      <button type="button" className={button} disabled={!result} onClick={() => {
        if (!result) return;
        try {
          downloadBrowserText(`${JSON.stringify(result, null, 2)}\n`, "private-draft-check.json", "application/json"); setMessage(copy.workspace.downloaded);
        } catch { setMessage(uiCopy("evidenceMatrix.downloadUnavailable")); }
      }}>{copy.workspace.download}</button>
      <button type="button" className={button} disabled={!result} onClick={() => {
        try {
          downloadBrowserText(`${JSON.stringify(request(), null, 2)}\n`, "private-draft-input.json", "application/json"); setMessage(copy.workspace.downloaded);
        } catch { setMessage(uiCopy("evidenceMatrix.downloadUnavailable")); }
      }}>{copy.retention.downloadInput}</button>
      <label className={button}>{copy.retention.importInput}<input ref={fileInput} type="file" accept=".json,application/json" className="ml-2 max-w-40" onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = "";
        const generation = ++editGeneration.current;
        if (!file) return;
        try { if (file.size > MAX_DRAFT_CHECK_BYTES) throw new Error("Invalid packet");
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (generation !== editGeneration.current) return;
          const packet = readDraftCheckFile(bytes);
          load(packet); setMessage(copy.retention.restored); }
        catch { if (generation === editGeneration.current) setMessage(copy.workspace.refused); }
      }} /></label>
      <button type="button" className={button} onClick={() => { editGeneration.current++; setPassage(""); setReferenceText(""); setSources({}); setSuggestions([]); setChosenClaims(undefined); setImportedFormat(undefined); setResult(undefined); setMessage(copy.workspace.cleared); }}>{copy.workspace.clear}</button>
    </div>
    <aside className="border border-line p-5" aria-label={copy.retention.heading}>
      <h2 className="font-display text-xl text-ink">{copy.retention.heading}</h2>
      <p className="mt-2 font-serif text-sm text-ink-2">{copy.retention.notice}</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="font-mono text-xs">{copy.retention.lifetime}<select className={field} value={lifetime} onChange={event => setLifetime(Number(event.target.value) as DraftCheckLifetime)}>
          <option value={3600}>{copy.retention.hour}</option><option value={86400}>{copy.retention.day}</option><option value={604800}>{copy.retention.week}</option>
        </select></label>
        <button type="button" className={button} disabled={!result} onClick={() => void retained(() => {
          saveDraftCheck(window.localStorage, request(), lifetime); setMessage(copy.retention.saved);
        })}>{copy.retention.save}</button>
        <button type="button" className={button} onClick={() => {
          const generation = ++editGeneration.current;
          void retained(() => {
            const saved = restoreDraftCheck(window.localStorage); if (saved) load(saved.request);
            setMessage(saved ? copy.retention.restored : copy.retention.absent);
          }, () => generation === editGeneration.current);
        }}>{copy.retention.restore}</button>
        <button type="button" className={button} onClick={() => void retained(() => {
          clearSavedDraftCheck(window.localStorage); setMessage(copy.retention.cleared);
        })}>{copy.retention.clear}</button>
      </div>
    </aside>
    <p role="status" aria-live="polite" className="font-serif text-sm text-seal">{message}</p>
    {result && <DraftCheckResults result={result} />}
  </section>;
}
