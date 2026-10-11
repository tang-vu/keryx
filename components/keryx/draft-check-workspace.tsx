"use client";

import { useMemo, useState } from "react";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { buildDraftCheck, DRAFT_CHECK_NOTICE, MAX_DRAFT_SOURCE_CHARACTERS, type DraftCheck, type DraftCheckRequest } from "@/lib/research/draft-check";
import { detectDraftReferenceFormat, parseDraftReferences, type DraftReference } from "@/lib/research/draft-check-references";
import { draftCheckCopy as copy, draftCheckCopyText as copyText } from "@/lib/research/draft-check-copy";

const field = "mt-2 block w-full min-w-0 rounded-none border border-line bg-paper px-3 py-2 font-serif text-sm text-ink";
const button = "inline-flex min-h-11 items-center border border-ink px-3 py-2 font-mono text-xs text-ink disabled:opacity-50";
const quote = "mt-2 whitespace-pre-wrap border-l-2 border-seal pl-3 font-serif text-sm text-ink";
interface SourceEditor { text: string; complete: boolean }
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
    </article>)}
    <h3 className="mt-6 font-display text-lg text-ink">{copy.flags.heading}</h3>
    {result.flags.length === 0 ? <p className="mt-2 font-serif text-sm text-ink-2">{copy.flags.none}</p> : <ul className="mt-2 list-disc pl-5 font-serif text-sm text-ink-2">
      {result.flags.map((flag, index) => <li key={index} className="break-words">{
        flag.kind === "citation-unresolved" ? copyText(copy.flags[flag.kind], { claim: claimLabel(flag.claim), token: flag.token })
          : flag.kind === "possible-different-work" ? copyText(copy.flags[flag.kind], { claim: claimLabel(flag.claim), author: flag.impliedAuthor, reference: flag.reference })
            : copyText(copy.flags[flag.kind], { reference: flag.reference })}</li>)}
    </ul>}
  </section>;
}

/** Tab-memory editor. The shared contract runs in this browser; no request is made. */
export function DraftCheckWorkspace() {
  const [passage, setPassage] = useState(""), [referenceText, setReferenceText] = useState("");
  const [sources, setSources] = useState<Record<string, SourceEditor>>({});
  const [result, setResult] = useState<DraftCheck>(), [message, setMessage] = useState("");
  const format = detectDraftReferenceFormat(referenceText);
  const references = useMemo<DraftReference[] | undefined>(() => {
    try { return parseDraftReferences(format, referenceText); } catch { return undefined; }
  }, [format, referenceText]);
  const edited = () => { if (result) { setResult(undefined); setMessage(copy.workspace.stale); } else setMessage(""); };
  const source = (key: string): SourceEditor => sources[key] ?? { text: "", complete: false };
  const setSource = (key: string, changes: Partial<SourceEditor>) => { setSources(current => ({ ...current, [key]: { ...(current[key] ?? { text: "", complete: false }), ...changes } })); edited(); };
  const usable = (references ?? []).filter(row => row.problem !== "duplicate-key");
  const run = () => {
    try {
      const request: DraftCheckRequest = { version: 1, scope: "private-draft-check", passage, references: { format, text: referenceText },
        sources: usable.filter(row => source(row.key).text.trim()).map(row => ({ reference: row.key, coverage: source(row.key).complete ? "full-text" as const : "partial" as const, text: source(row.key).text })) };
      setResult(buildDraftCheck(request)); setMessage(copy.workspace.done);
    } catch { setResult(undefined); setMessage(copy.workspace.refused); }
  };
  return <section className="mt-8 space-y-6" aria-label={copy.workspace.label}>
    <p className="font-serif text-sm leading-relaxed text-ink-2">{DRAFT_CHECK_NOTICE}</p>
    <p className="font-serif text-sm text-ink-2">{copy.workspace.privacy}</p>
    <div className="border border-line bg-paper p-5">
      <label className="font-mono text-xs text-ink-2">{copy.passage.label}
        <textarea className={field} rows={7} maxLength={12000} value={passage} onChange={event => { setPassage(event.target.value); edited(); }} />
      </label>
      <p className="mt-2 font-serif text-xs text-ink-3">{copy.passage.guidance}</p>
    </div>
    <div className="border border-line bg-paper p-5">
      <label className="font-mono text-xs text-ink-2">{copy.references.label}
        <textarea className={field} rows={6} maxLength={24000} spellCheck={false} value={referenceText} onChange={event => { setReferenceText(event.target.value); edited(); }} />
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
        downloadBrowserText(`${JSON.stringify(result, null, 2)}\n`, "private-draft-check.json", "application/json"); setMessage(copy.workspace.downloaded);
      }}>{copy.workspace.download}</button>
      <button type="button" className={button} onClick={() => { setPassage(""); setReferenceText(""); setSources({}); setResult(undefined); setMessage(copy.workspace.cleared); }}>{copy.workspace.clear}</button>
    </div>
    <p role="status" aria-live="polite" className="font-serif text-sm text-seal">{message}</p>
    {result && <DraftCheckResults result={result} />}
  </section>;
}
