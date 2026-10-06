"use client";

import { useEffect, useRef, useState } from "react";
import { PaperCard } from "./paper-card";
import { paperSearchResultSchema, type PaperSearchResult } from "@/lib/papers/types";
import { normalizeDoi } from "@/lib/scholarly/doi";

/** No effect or prefetch starts external discovery. Each submit is a separate explicit action. */
export function PaperSearchPanel({ initialQuery = "", author, year }: { initialQuery?: string; author?: string; year?: string }) {
  const [result, setResult] = useState<PaperSearchResult>(), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return <section aria-labelledby="paper-search-title" className="mt-5 border border-line bg-paper p-5 sm:p-6">
    <h3 id="paper-search-title" className="font-display text-xl text-ink">Search beyond the starter library</h3>
    <p id="paper-search-privacy" className="mt-2 font-serif text-sm leading-relaxed text-ink-2">Submitting sends your query or identifier to arXiv and Crossref as applicable. Results are bibliographic previews; metadata search does not read papers, run a model or make payments.</p>
    <form aria-describedby="paper-search-privacy" className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={async event => {
      event.preventDefault(); if (busy) return;
      const form = event.currentTarget, value = new FormData(form).get("query");
      if (typeof value !== "string" || !value.trim()) return;
      request.current?.abort(); const controller = new AbortController(); request.current = controller;
      setBusy(true); setError(""); setResult(undefined);
      try {
        const doi = normalizeDoi(value.trim());
        const params = new URLSearchParams(doi ? { doi, search: "1" } : { q: value.trim(), search: "1" });
        if (author) params.set("author", author);
        if (year) params.set("year", year);
        const response = await fetch(`/api/papers?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error(response.status === 429 ? "Paper search is busy. Wait a minute before another search." : "Paper search could not be completed. Check the query or try later.");
        const parsed = paperSearchResultSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Paper search returned an unsupported response.");
        if (!controller.signal.aborted) setResult(parsed.data);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Paper search unavailable."); }
      finally { if (request.current === controller) setBusy(false); }
    }}>
      <label className="min-w-0 flex-1 font-mono text-[11px] text-ink-2">Title, topic, DOI or versioned arXiv identifier
        <input name="query" type="search" maxLength={200} defaultValue={initialQuery} required placeholder="Retrieval augmented generation" className="mt-1 block min-h-11 w-full border border-line bg-paper-2 px-3 font-serif text-base text-ink" />
      </label>
      <button type="submit" disabled={busy} className="mt-auto min-h-11 border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper disabled:opacity-60">{busy ? "Searching…" : "Search repositories"}</button>
      {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); }} className="min-h-11 font-mono text-xs text-seal underline">Cancel</button>}
    </form>
    <p className="mt-2 font-serif text-xs text-ink-3">Titles and topics: up to 120 characters. Exact DOI: up to 200. Use at most two exact identifiers per search.</p>
    {(author || year) && <p className="mt-2 font-serif text-xs text-ink-3">Author/year filters above also filter the returned bibliographic sample.</p>}
    <div role="status" aria-live="polite" className="mt-3 font-serif text-sm text-ink-2">
      {error || (busy ? "Requesting bounded bibliographic records…" : result && `${result.totalWorks} matching works in this bounded result set.`)}
      {result && <ul className="mt-2 space-y-1">{result.providers.map((provider, index) => <li key={`${provider.name}:${index}`}>{provider.name === "arxiv" ? "arXiv" : "Crossref"}: {provider.status === "unavailable" ? "temporarily unavailable; no empty result inferred" : provider.status === "empty" ? "no matching records accepted" : `${provider.records} observed records`}</li>)}</ul>}
    </div>
    {result && <><p className="mt-3 font-serif text-xs leading-relaxed text-ink-3">Up to two provider requests and six records per provider response. This is a bounded sample, not a complete literature review. Matching starter records are included; unavailable providers remain explicit.</p><div className="mt-4 grid gap-4 md:grid-cols-2">{result.groups.map(group => <PaperCard key={group.id} group={group} />)}</div></>}
  </section>;
}
