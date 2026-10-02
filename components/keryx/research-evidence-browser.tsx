"use client";

import { useEffect, useRef, useState } from "react";
import {
  EVIDENCE_PAGE_SIZE, EVIDENCE_SOURCE_LIMIT, evidencePageSchema, evidencePreviewSchema,
  filterEvidenceSources, mergeEvidenceSources, type EvidencePreview, type EvidenceSource,
} from "@/lib/research/evidence-browser";

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
    <h2 id="research-evidence-heading" className="font-display text-2xl">Inspect the evidence before paying</h2>
    <p className="mt-2 max-w-3xl font-serif text-sm text-ink-2">Browse listed creator sources and their public previews to judge whether this corpus fits your question. This does not select sources for your job or guarantee a supported answer.</p>
    <p className="mt-2 font-serif text-xs text-ink-3">Research uses registered creator content and free public feed references. It does not browse the whole web or buy external marketplace endpoints. <a href="/sources" className="underline">See the registry and free references</a>.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <div className="min-w-0">
        <label htmlFor="evidence-source-search" className="font-mono text-xs">Search loaded source names, descriptions and tags</label>
        <input id="evidence-source-search" type="search" maxLength={200} value={query} onChange={(event) => { setQuery(event.target.value); chooseSource(""); }} className="mt-2 w-full border border-line bg-paper-2 p-3 text-sm" />
        <p role="status" className="mt-2 font-serif text-xs text-ink-3">{total === null ? "Source list not yet available." : `${sources.length} of ${total} listed sources loaded. Search covers only these loaded sources.`}</p>
        {listState === "loading" && <p role="status" className="mt-2 text-sm">Loading source list…</p>}
        {listState === "error" && <p role="alert" className="mt-2 text-sm text-seal">Source list could not be loaded. Its availability is unknown. <button type="button" onClick={() => { setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="underline">Retry source list</button></p>}
        {sources.length > 0 && <>
          <label htmlFor="evidence-source-select" className="mt-3 block font-mono text-xs">Choose a source to inspect</label>
          <select id="evidence-source-select" value={selectedId} onChange={(event) => chooseSource(event.target.value)} className="mt-2 w-full border border-line bg-paper-2 p-3 text-sm">
            <option value="">Select a listed source</option>
            {matches.map((source) => <option key={source.id} value={source.id}>{source.name}{source.evidenceProvenance === "synthetic-demo" ? " ? synthetic demo" : ""}{source.verified === false ? " — ownership unverified" : ""}</option>)}
          </select>
        </>}
        {listState === "ready" && sources.length === 0 && <p className="mt-3 text-sm text-ink-2">No creator sources are currently listed. Free references may still be available in the registry.</p>}
        {sources.length > 0 && matches.length === 0 && <p className="mt-3 text-sm text-ink-2">No match in loaded sources. This is not a verdict on whether Keryx can answer your question.</p>}
        {cursor && sources.length < EVIDENCE_SOURCE_LIMIT && <button type="button" disabled={listState === "loading"} onClick={() => { cursorRef.current = cursor; setListState("loading"); setListAttempt((attempt) => attempt + 1); }} className="mt-3 border border-line px-3 py-2 font-mono text-xs disabled:opacity-40">Load more sources</button>}
        {cursor && sources.length >= EVIDENCE_SOURCE_LIMIT && <p className="mt-3 text-xs text-ink-3">This view is limited to {EVIDENCE_SOURCE_LIMIT} sources. Browse the full registry above.</p>}
      </div>
      <div aria-live="polite" className="min-w-0 break-words">
        {!selected && <p className="text-sm text-ink-3">Select a source for up to five public article previews. Previews may be excerpts or titles only; they do not establish full-text availability or current payout eligibility.</p>}
        {selected && <>
          <h3 className="font-serif text-lg">{selected.name}</h3>
          <p className="mt-2 text-sm text-ink-2">{selected.description}</p>
          {selected.evidenceProvenance === "synthetic-demo" && <p className="mt-2 text-sm text-seal">Synthetic demo content: illustrative only; excluded from factual production research.</p>}
          {selected.verified === false && <p className="mt-2 text-sm text-seal">Ownership unverified: this listing is excluded from the research agent&apos;s creator reading and payment path.</p>}
          <p className="mt-2 text-xs text-ink-3">Listing flags can include legacy defaults. An unflagged listing is not independent proof of ownership, live delivery or payout authority.</p>
          {previewState === "loading" && <p role="status" className="mt-3 text-sm">Loading public preview…</p>}
          {previewState === "error" && <p role="alert" className="mt-3 text-sm text-seal">Public preview unavailable. No content availability has been established. <button type="button" onClick={() => { setPreview(null); setPreviewState("loading"); setPreviewAttempt((attempt) => attempt + 1); }} className="underline">Retry preview</button></p>}
          {previewState === "ready" && visiblePreview && <>
            <p className="mt-3 font-mono text-xs text-ink-3">{visiblePreview.previewDepth === "locked" ? "Title-only public preview" : "Public preview summaries"} · not paid article content</p>
            {visiblePreview.preview.length === 0 && <p className="mt-2 text-sm">No public article previews are available for this source.</p>}
            <ul className="mt-2 max-h-64 space-y-3 overflow-y-auto">
              {visiblePreview.preview.map((item) => <li key={item.itemId} className="border-t border-line pt-2">
                <p className="font-serif text-sm">{item.title}</p>
                {item.evidenceProvenance === "synthetic-demo" && <p className="text-xs text-seal">Synthetic demo article ? illustrative only</p>}
                {item.itemPublishedAt && <p className="mt-1 font-mono text-xs text-ink-3">Publisher date: {item.itemPublishedAt}</p>}
                {visiblePreview.previewDepth !== "locked" && item.summary && <p className="mt-1 whitespace-pre-wrap font-serif text-xs text-ink-2">{item.summary}</p>}
              </li>)}
            </ul>
          </>}
        </>}
      </div>
    </div>
    <p className="mt-4 border-t border-line pt-3 font-serif text-xs text-ink-3">Own a useful feed? <a href="/register" className="underline">List and verify your source</a>. Listing does not guarantee that an agent will buy or cite it.</p>
  </section>;
}
