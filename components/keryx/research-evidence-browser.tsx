"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useRef, useState } from "react";
import {
  EVIDENCE_PAGE_SIZE, EVIDENCE_SOURCE_LIMIT, evidencePageSchema, evidencePreviewSchema,
  filterEvidenceSources, mergeEvidenceSources, type EvidencePreview, type EvidenceSource,
} from "@/lib/research/evidence-browser";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

export function ResearchEvidenceBrowser() {
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

  return <section aria-labelledby="research-evidence-heading" className="border border-line bg-paper p-6">
    <h2 id="research-evidence-heading" className="font-display text-2xl">{copy("researchEvidence.title")}</h2>
    <p className="mt-2 max-w-3xl font-serif text-sm text-ink-2">{copy("researchEvidence.introduction")}</p>
    <p className="mt-2 font-serif text-xs text-ink-3">{richCopy("researchEvidence.corpusNotice", { registryLink: <a href="/sources" className="underline">{copy("researchEvidence.registry")}</a> })}</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="min-w-0">
        <label htmlFor="evidence-source-search" className="font-mono text-xs">{copy("researchEvidence.search")}</label>
        <input id="evidence-source-search" type="search" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); chooseSource(""); }} className="mt-2 w-full border border-line bg-paper-2 p-3 text-sm" />
        <p role="status" className="mt-2 font-serif text-xs text-ink-3">{total === null ? copy("researchEvidence.listNotAvailable") : copy(total === 1 ? "researchEvidence.loaded.one" : "researchEvidence.loaded.other", { loaded: sources.length, count: total })}</p>
        {listState === "loading" && <p role="status" className="mt-2 text-sm">{copy("researchEvidence.listLoading")}</p>}
        {listState === "error" && <p role="alert" className="mt-2 text-sm text-seal">{richCopy("researchEvidence.listFailed", { retryButton: <button type="button" onClick={() => { setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="underline">{copy("researchEvidence.retryList")}</button> })}</p>}
        {sources.length > 0 && <>
          <label htmlFor="evidence-source-select" className="mt-3 block font-mono text-xs">{copy("researchEvidence.chooseSource")}</label>
          <select id="evidence-source-select" value={selectedId} onChange={(event) => chooseSource(event.target.value)} className="mt-2 w-full border border-line bg-paper-2 p-3 text-sm">
            <option value="">{copy("researchEvidence.selectSource")}</option>
            {matches.map((source) => <option key={source.id} value={source.id}>{source.evidenceProvenance !== "synthetic-demo" && source.verified !== false ? source.name : copy(source.evidenceProvenance === "synthetic-demo" ? source.verified === false ? "researchEvidence.sourceOption.syntheticUnverified" : "researchEvidence.sourceOption.synthetic" : source.verified === false ? "researchEvidence.sourceOption.unverified" : "researchEvidence.sourceOption.synthetic", { name: source.name })}</option>)}
          </select>
        </>}
        {listState === "ready" && sources.length === 0 && <p className="mt-3 text-sm text-ink-2">{copy("researchEvidence.emptyList")}</p>}
        {sources.length > 0 && matches.length === 0 && <p className="mt-3 text-sm text-ink-2">{copy("researchEvidence.noMatch")}</p>}
        {cursor && sources.length < EVIDENCE_SOURCE_LIMIT && <button type="button" disabled={listState === "loading"} onClick={() => { cursorRef.current = cursor; setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="mt-3 border border-line px-3 py-2 font-mono text-xs disabled:opacity-40">{copy("researchEvidence.loadMore")}</button>}
        {cursor && sources.length >= EVIDENCE_SOURCE_LIMIT && <p className="mt-3 text-xs text-ink-3">{copy("researchEvidence.limit.other", { count: EVIDENCE_SOURCE_LIMIT })}</p>}
      </div>
      <div aria-live="polite" className="min-w-0 break-words">
        {!selected && <p className="text-sm text-ink-3">{copy("researchEvidence.previewNotice")}</p>}
        {selected && <>
          <h3 className="font-serif text-lg">{selected.name}</h3>
          <p className="mt-2 text-sm text-ink-2">{selected.description}</p>
          {selected.evidenceProvenance === "synthetic-demo" && <p className="mt-2 text-sm text-seal">{copy("researchEvidence.syntheticSource")}</p>}
          {selected.verified === false && <p className="mt-2 text-sm text-seal">{copy("researchEvidence.unverifiedOwnership")}</p>}
          <p className="mt-2 text-xs text-ink-3">{copy("researchEvidence.listingFlags")}</p>
          {previewState === "loading" && <p role="status" className="mt-3 text-sm">{copy("researchEvidence.previewLoading")}</p>}
          {previewState === "error" && <p role="alert" className="mt-3 text-sm text-seal">{richCopy("researchEvidence.previewFailed", { retryButton: <button type="button" onClick={() => { setPreview(null); setPreviewState("loading"); setPreviewAttempt((attempt) => attempt + 1); }} className="underline">{copy("researchEvidence.retryPreview")}</button> })}</p>}
          {previewState === "ready" && visiblePreview && <>
            <p className="mt-3 font-mono text-xs text-ink-3">{copy(visiblePreview.previewDepth === "locked" ? "researchEvidence.titleOnly" : "researchEvidence.summaries")}</p>
            {visiblePreview.preview.length === 0 && <p className="mt-2 text-sm">{copy("researchEvidence.emptyPreview")}</p>}
            <ul className="mt-2 max-h-64 space-y-3 overflow-y-auto">
              {visiblePreview.preview.map((item) => <li key={item.itemId} className="border-t border-line pt-2">
                <p className="font-serif text-sm">{item.title}</p>
                {item.evidenceProvenance === "synthetic-demo" && <p className="text-xs text-seal">{copy("researchEvidence.syntheticArticle")}</p>}
                {item.itemPublishedAt && <p className="mt-1 font-mono text-xs text-ink-3">{copy("researchEvidence.publisherDate", { date: item.itemPublishedAt })}</p>}
                {visiblePreview.previewDepth !== "locked" && item.summary && <p className="mt-1 whitespace-pre-wrap font-serif text-xs text-ink-2">{item.summary}</p>}
              </li>)}
            </ul>
          </>}
        </>}
      </div>
    </div>
    <p className="mt-4 border-t border-line pt-3 font-serif text-xs text-ink-3">{richCopy("researchEvidence.registrationNotice", { registrationLink: <a href="/register" className="underline">{copy("researchEvidence.register")}</a> })}</p>
  </section>;
}
