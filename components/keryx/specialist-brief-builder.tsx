"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { SPECIALIST_BRIEF_IDS, specialistBriefs, prepareSpecialistBrief, type SpecialistBriefId } from "@/lib/research/specialist-briefs";
import { specialistBriefCopy as copy } from "@/locales/en/specialist-briefs";

type Prepared = ReturnType<typeof prepareSpecialistBrief>;
const fieldClass = "w-full min-w-0 border border-line bg-paper-2 p-3 font-serif text-base text-ink";
const linkClass = "inline-flex min-h-11 items-center font-mono text-sm text-paid underline underline-offset-4";

export function SpecialistBriefBuilder() {
  const [track, setTrack] = useState<SpecialistBriefId>("api-platform");
  const [decision, setDecision] = useState("");
  const [context, setContext] = useState("");
  const [sources, setSources] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const revision = useRef(0);
  const clear = () => { revision.current++; setPrepared(null); setError(false); setCopyStatus(""); };
  const submit = (event: FormEvent) => {
    event.preventDefault(); revision.current++; setCopyStatus("");
    try {
      setPrepared(prepareSpecialistBrief({ track, decision, context,
        sourceLeads: sources.split(/\r?\n/u).map(value => value.trim()).filter(Boolean) }));
      setError(false);
    } catch { setPrepared(null); setError(true); }
  };
  const copyRequest = async () => {
    if (!prepared || copyPending) return;
    const originalRevision = revision.current; setCopyPending(true);
    try {
      await navigator.clipboard.writeText(prepared.request.question);
      if (revision.current === originalRevision) setCopyStatus(copy.copied);
    } catch { if (revision.current === originalRevision) setCopyStatus(copy.copyFailed); }
    finally { setCopyPending(false); }
  };
  const download = () => {
    if (!prepared) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(prepared.request, null, 2) + "\n"], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url;
    anchor.download = `keryx-${prepared.track}-request.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    <form onSubmit={submit} className="mt-8 space-y-6">
      <fieldset>
        <legend className="mb-4 font-display text-2xl">{copy.selectTrack}</legend>
        <div className="grid gap-4 md:grid-cols-3">
          {SPECIALIST_BRIEF_IDS.map(id => {
            const brief = specialistBriefs[id];
            return <label key={id} className={`cursor-pointer border p-5 ${id === track ? "border-paid bg-paper" : "border-line"}`}>
              <span className="flex items-start gap-3"><input type="radio" name="brief-track" value={id} checked={id === track}
                onChange={() => { setTrack(id); clear(); }} className="mt-1" /><span className="font-display text-xl">{brief.title}</span></span>
              <span className="mt-3 block font-mono text-xs text-seal">{brief.audience}</span>
              <span className="mt-3 block font-serif text-ink-2">{brief.scope}</span>
            </label>;
          })}
        </div>
      </fieldset>
      <div className="grid items-start gap-6 md:grid-cols-2">
        <label className="grid gap-2 font-mono text-sm">{copy.decision}
          <textarea required maxLength={450} rows={4} value={decision} placeholder={specialistBriefs[track].placeholder}
            aria-describedby="brief-decision-help" onChange={event => { setDecision(event.target.value); clear(); }} className={fieldClass} />
          <span id="brief-decision-help" className="font-serif text-sm text-ink-3">{copy.decisionHelp}</span>
        </label>
        <label className="grid gap-2 font-mono text-sm">{copy.context}
          <textarea maxLength={250} rows={4} value={context} placeholder={copy.contextPlaceholder}
            onChange={event => { setContext(event.target.value); clear(); }} className={fieldClass} />
        </label>
      </div>
      <label className="grid max-w-[76ch] gap-2 font-mono text-sm">{copy.sources}
        <textarea maxLength={325} rows={2} value={sources} aria-describedby="brief-source-help"
          onChange={event => { setSources(event.target.value); clear(); }} className={fieldClass} />
        <span id="brief-source-help" className="font-serif text-sm text-ink-3">{copy.sourcesHelp}</span>
      </label>
      <p className="max-w-[80ch] font-serif text-sm text-seal">{copy.privacy}</p>
      <button type="submit" className="min-h-11 bg-ink px-5 py-3 font-mono text-sm text-paper">{copy.prepare}</button>
      {error && <p role="alert" className="max-w-[80ch] font-serif text-seal">{copy.invalid}</p>}
    </form>
    {prepared && <section className="mt-8 border border-paid bg-paper p-5 sm:p-7" aria-labelledby="brief-request-heading">
      <h2 id="brief-request-heading" className="font-display text-2xl">{copy.review}</h2>
      <textarea aria-label={copy.review} readOnly value={prepared.request.question} rows={10} className={`${fieldClass} mt-4 text-sm`} />
      <h3 className="mt-5 font-display text-xl">{copy.rubric}</h3>
      <ul className="mt-3 list-disc space-y-2 pl-5 font-serif text-ink-2">{prepared.acceptanceChecklist.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="mt-3 font-serif text-sm text-ink-3">{copy.rubricNotice}</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <button type="button" onClick={copyRequest} disabled={copyPending} className="min-h-11 border border-ink px-4 py-2 font-mono text-sm disabled:opacity-50">{copy.copy}</button>
        <button type="button" onClick={download} className="min-h-11 border border-line px-4 py-2 font-mono text-sm">{copy.download}</button>
      </div>
      <p role="status" className="mt-3 font-serif text-sm text-paid">{copyStatus}</p>
      <p className="mt-4 max-w-[80ch] font-serif text-sm text-ink-2">{copy.handoff}</p>
      <nav className="mt-3 flex flex-wrap gap-x-6" aria-label={copy.review}>
        <Link href="/research?mode=deep#paid-research" prefetch={false} className={linkClass}>{copy.checkout}</Link>
        <Link href="/?mode=deep#dispatch" prefetch={false} className={linkClass}>{copy.trial}</Link>
      </nav>
    </section>}
  </>;
}
