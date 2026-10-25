"use client";



import { useEffect, useRef, useState } from "react";
import {
  EVIDENCE_PAGE_SIZE, EVIDENCE_SOURCE_LIMIT, evidencePageSchema, evidencePreviewSchema,
  filterEvidenceSources, mergeEvidenceSources, type EvidencePreview, type EvidenceSource,
} from "@/lib/research/evidence-browser";
import { useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";






export function ResearchEvidenceBrowser() {
  const copy = useUiMessages();
  const richCopy = useUiRichMessages();
  const [sources, setSources] = useState<EvidenceSource[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listAttempt, setListAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [previewState, setPreviewState] = useState<"loading" | "ready" | "error">("loading");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const cursorRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    const pageCursor = cursorRef.current;
    const url = `/api/sources?limit=${EVIDENCE_PAGE_SIZE}${pageCursor ? `&cursor=${encodeURIComponent(pageCursor)}` : ""}`;
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Sources unavailable");
        const page = evidencePageSchema.parse(await response.json());
        if (page.nextCursor === pageCursor && pageCursor) throw new Error("Cursor did not advance");
        if (!current) return;
        setSources((previous) => mergeEvidenceSources(previous, page.sources));
        setTotal(page.total);
        setCursor(page.nextCursor);
        setListState("ready");
      } catch {
        if (current) setListState("error");
      } finally { window.clearTimeout(timer); }
    })();
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [listAttempt]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    let current = true;
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    void (async () => {
      try {
        const response = await fetch(`/api/source/${encodeURIComponent(selectedId)}/preview`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Preview unavailable");
        const data = evidencePreviewSchema.parse(await response.json());
        if (data.id !== selectedId) throw new Error("Wrong source preview");
        if (!current) return;
        setPreview(data);
        setPreviewState("ready");
      } catch {
        if (current) setPreviewState("error");
      } finally { window.clearTimeout(timer); }
    })();
    return () => { current = false; window.clearTimeout(timer); controller.abort(); };
  }, [selectedId, previewAttempt]);

  const matches = filterEvidenceSources(sources, query);
  const selected = sources.find((source) => source.id === selectedId);
  const visiblePreview = preview?.id === selectedId ? preview : null;
  function chooseSource(id: string) {
    setSelectedId(id);
    setPreview(null);
    setPreviewState("loading");
  }

  return <section aria-labelledby="research-evidence-heading" className="kx-source-inspector border border-line bg-paper [overflow-wrap:anywhere]">
    <header className="border-b border-line px-5 py-6 sm:px-8 sm:py-8">
      <h2 id="research-evidence-heading" className="max-w-3xl font-display text-[30px] leading-[1.15] sm:text-4xl">{copy("researchEvidence.title")}</h2>
      <p className="mt-3 max-w-3xl font-serif text-[15px] leading-relaxed text-ink-2">{copy("researchEvidence.introduction")}</p>
      <p className="mt-3 max-w-3xl font-serif text-[13px] leading-relaxed text-ink-3">{richCopy("researchEvidence.corpusNotice", { registryLink: <a href="/sources" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy("researchEvidence.registry")}</a> })}</p>
    </header>
    <div className="grid md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 border-b border-line bg-paper-2 px-5 py-6 sm:px-8 md:border-b-0 md:border-r">
        <label htmlFor="evidence-source-search" className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.08em]">{copy("researchEvidence.search")}</label>
        <div className="relative mt-2">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
          <input id="evidence-source-search" type="search" maxLength={200} value={query} aria-describedby="evidence-source-count" onChange={(event) => { setQuery(event.target.value); chooseSource(""); }} className="block min-h-12 w-full min-w-0 border border-line bg-paper py-3 pl-10 pr-3 font-serif text-base text-ink focus-visible:border-brass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal" />
        </div>
        <p id="evidence-source-count" role="status" className="mt-3 font-serif text-[13px] leading-relaxed text-ink-3">{total === null ? copy("researchEvidence.listNotAvailable") : copy(total === 1 ? "researchEvidence.loaded.one" : "researchEvidence.loaded.other", { loaded: sources.length, count: total })}</p>
        {listState === "loading" && <p role="status" className="mt-4 flex items-center gap-2 text-sm text-ink-2"><LoadingMark />{copy("researchEvidence.listLoading")}</p>}
        {listState === "error" && <p role="alert" className="mt-4 border-l-2 border-seal bg-paper px-4 py-3 text-sm leading-relaxed text-seal">{richCopy("researchEvidence.listFailed", { retryButton: <button type="button" onClick={() => { setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="mt-2 flex min-h-11 items-center border border-seal px-3 py-2 font-mono text-xs hover:bg-seal hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy("researchEvidence.retryList")}</button> })}</p>}
        {sources.length > 0 && <>
          <label htmlFor="evidence-source-select" className="mt-6 block font-mono text-[11px] uppercase leading-relaxed tracking-[0.08em]">{copy("researchEvidence.chooseSource")}</label>
          <select id="evidence-source-select" value={selectedId} onChange={(event) => chooseSource(event.target.value)} className="mt-2 block min-h-12 w-full min-w-0 max-w-full border border-line bg-paper px-3 py-3 font-serif text-base text-ink focus-visible:border-brass focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">
            <option value="">{copy("researchEvidence.selectSource")}</option>
            {matches.map((source) => <option key={source.id} value={source.id}>{source.evidenceProvenance !== "synthetic-demo" && source.verified !== false ? source.name : copy(source.evidenceProvenance === "synthetic-demo" ? source.verified === false ? "researchEvidence.sourceOption.syntheticUnverified" : "researchEvidence.sourceOption.synthetic" : source.verified === false ? "researchEvidence.sourceOption.unverified" : "researchEvidence.sourceOption.synthetic", { name: source.name })}</option>)}
          </select>
        </>}
        {listState === "ready" && sources.length === 0 && <p className="mt-5 border-t border-line pt-4 text-sm leading-relaxed text-ink-2">{copy("researchEvidence.emptyList")}</p>}
        {sources.length > 0 && matches.length === 0 && <p className="mt-5 border-l-2 border-brass pl-4 text-sm leading-relaxed text-ink-2">{copy("researchEvidence.noMatch")}</p>}
        {cursor && sources.length < EVIDENCE_SOURCE_LIMIT && <button type="button" disabled={listState === "loading"} onClick={() => { cursorRef.current = cursor; setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="mt-5 inline-flex min-h-11 items-center gap-3 border border-ink bg-paper px-4 py-3 font-mono text-xs hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal disabled:cursor-wait disabled:opacity-40">{copy("researchEvidence.loadMore")}<span aria-hidden="true">+</span></button>}
        {cursor && sources.length >= EVIDENCE_SOURCE_LIMIT && <p className="mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-ink-3">{copy("researchEvidence.limit.other", { count: EVIDENCE_SOURCE_LIMIT })}</p>}
      </div>
      <div aria-live="polite" className="min-w-0 px-5 py-6 sm:px-8">
        {!selected && <div className="flex min-h-48 flex-col items-start justify-center py-4">
          <svg aria-hidden="true" className="mb-5 text-brass" width="44" height="44" viewBox="0 0 44 44" fill="none" stroke="currentColor"><path d="M9 5h19l7 7v27H9zM28 5v8h7M15 21h14M15 27h14M15 33h8" /><path d="M5 10v30h24" opacity=".35" /></svg>
          <p className="max-w-md font-serif text-base leading-relaxed text-ink-3">{copy("researchEvidence.previewNotice")}</p>
        </div>}
        {selected && <div key={selected.id} className="kx-source-preview">
          <h3 className="font-display text-[26px] leading-tight text-ink">{selected.name}</h3>
          <p className="mt-3 font-serif text-[15px] leading-relaxed text-ink-2">{selected.description}</p>
          {selected.evidenceProvenance === "synthetic-demo" && <p className="mt-3 border-l-2 border-seal pl-3 text-sm leading-relaxed text-seal">{copy("researchEvidence.syntheticSource")}</p>}
          {selected.verified === false && <p className="mt-3 border-l-2 border-seal pl-3 text-sm leading-relaxed text-seal">{copy("researchEvidence.unverifiedOwnership")}</p>}
          <p className="mt-3 text-[13px] leading-relaxed text-ink-3">{copy("researchEvidence.listingFlags")}</p>
          {previewState === "loading" && <div className="mt-5 border-t border-line pt-5">
            <p role="status" className="flex items-center gap-2 text-sm text-ink-2"><LoadingMark />{copy("researchEvidence.previewLoading")}</p>
            <div aria-hidden="true" className="mt-5 space-y-3"><div className="h-2 w-4/5 bg-line" /><div className="h-2 w-full bg-line-2" /><div className="h-2 w-3/5 bg-line-2" /></div>
          </div>}
          {previewState === "error" && <p role="alert" className="mt-5 border-l-2 border-seal bg-paper-2 px-4 py-3 text-sm leading-relaxed text-seal">{richCopy("researchEvidence.previewFailed", { retryButton: <button type="button" onClick={() => { setPreview(null); setPreviewState("loading"); setPreviewAttempt((attempt) => attempt + 1); }} className="mt-2 flex min-h-11 items-center border border-seal px-3 py-2 font-mono text-xs hover:bg-seal hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy("researchEvidence.retryPreview")}</button> })}</p>}
          {previewState === "ready" && visiblePreview && <>
            <p className="mt-5 border-t border-line pt-4 font-mono text-[11px] uppercase leading-relaxed tracking-[0.08em] text-ink-3">{copy(visiblePreview.previewDepth === "locked" ? "researchEvidence.titleOnly" : "researchEvidence.summaries")}</p>
            {visiblePreview.preview.length === 0 && <p className="mt-4 font-serif text-sm leading-relaxed text-ink-3">{copy("researchEvidence.emptyPreview")}</p>}
            {visiblePreview.preview.length > 0 && <div data-preview-articles role="region" aria-label={copy(visiblePreview.previewDepth === "locked" ? "researchEvidence.titleOnly" : "researchEvidence.summaries")} tabIndex={0} className="kx-source-articles mt-3 max-h-[28rem] overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-seal">
              <ul role="list" className="space-y-3 pr-2">
                {visiblePreview.preview.map((item) => <li key={item.itemId} className="border border-line bg-paper-2 px-4 py-4">
                  <h4 className="font-serif text-lg leading-snug text-ink">{item.title}</h4>
                  {item.evidenceProvenance === "synthetic-demo" && <p className="text-xs text-seal">{copy("researchEvidence.syntheticArticle")}</p>}
                  {item.itemPublishedAt && <p className="mt-2 font-mono text-[11px] leading-relaxed text-ink-3">{copy("researchEvidence.publisherDate", { date: item.itemPublishedAt })}</p>}
                  {visiblePreview.previewDepth !== "locked" && item.summary && <p className="mt-3 whitespace-pre-wrap font-serif text-sm leading-relaxed text-ink-2">{item.summary}</p>}
                </li>)}
              </ul>
            </div>}
          </>}
        </div>}
      </div>
    </div>
    <p className="border-t border-line px-5 py-4 font-serif text-[13px] leading-relaxed text-ink-3 sm:px-8">{richCopy("researchEvidence.registrationNotice", { registrationLink: <a href="/register" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal">{copy("researchEvidence.register")}</a> })}</p>
  </section>;
}

function LoadingMark() {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0 motion-safe:animate-spin" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="10" cy="10" r="7" opacity=".2" /><path d="M10 3a7 7 0 0 1 7 7" strokeLinecap="round" /></svg>;
}
