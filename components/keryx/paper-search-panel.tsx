"use client";


import { useEffect, useRef, useState } from "react";
import { PaperCard } from "./paper-card";
import { paperSearchResultSchema, type PaperSearchResult } from "@/lib/papers/types";
import { normalizeDoi } from "@/lib/scholarly/doi";
import { useUiMessages } from "@/lib/i18n/ui-copy";





/** No effect or prefetch starts external discovery. Each submit is a separate explicit action. */
export function PaperSearchPanel({ initialQuery = "", author, year }: { initialQuery?: string; author?: string; year?: string }) {
  const copy = useUiMessages();
  const [result, setResult] = useState<PaperSearchResult>(), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  return <section aria-labelledby="paper-search-title" className="mt-5 border border-line bg-paper p-5 sm:p-6">
    <h3 id="paper-search-title" className="font-display text-xl text-ink">{copy("paperSearch.title")}</h3>
    <p id="paper-search-privacy" className="mt-2 font-serif text-sm leading-relaxed text-ink-2">{copy("paperSearch.privacy")}</p>
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
        if (!response.ok) throw new Error(response.status === 429 ? copy("paperSearch.busyError") : copy("paperSearch.incomplete"));
        const parsed = paperSearchResultSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error(copy("paperSearch.unsupported"));
        if (!controller.signal.aborted) setResult(parsed.data);
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : copy("paperSearch.unavailable")); }
      finally { if (request.current === controller) setBusy(false); }
    }}>
      <label className="min-w-0 flex-1 font-mono text-[11px] text-ink-2">{copy("paperSearch.query")}
        <input name="query" type="search" maxLength={200} defaultValue={initialQuery} required placeholder={copy("paperSearch.placeholder")} className="mt-1 block min-h-11 w-full border border-line bg-paper-2 px-3 font-serif text-base text-ink" />
      </label>
      <button type="submit" disabled={busy} className="mt-auto min-h-11 border border-ink bg-seal px-4 py-2 font-mono text-xs text-paper disabled:opacity-60">{busy ? copy("paperSearch.searching") : copy("paperSearch.search")}</button>
      {busy && <button type="button" onClick={() => { request.current?.abort(); setBusy(false); }} className="min-h-11 font-mono text-xs text-seal underline">{copy("paperSearch.cancel")}</button>}
    </form>
    <p className="mt-2 font-serif text-xs text-ink-3">{copy("paperSearch.limits")}</p>
    {(author || year) && <p className="mt-2 font-serif text-xs text-ink-3">{copy("paperSearch.filters")}</p>}
    <div role="status" aria-live="polite" className="mt-3 font-serif text-sm text-ink-2">
      {error || (busy ? copy("paperSearch.requesting") : result && copy(result.totalWorks === 1 ? "paperSearch.matches.one" : "paperSearch.matches.other", { count: result.totalWorks }))}
      {result && <ul className="mt-2 space-y-1">{result.providers.map((provider, index) => <li key={`${provider.name}:${index}`}>{provider.status === "unavailable" ? copy("paperSearch.providerUnavailable", { provider: provider.name === "arxiv" ? "arXiv" : "Crossref" }) : provider.status === "empty" ? copy("paperSearch.providerEmpty", { provider: provider.name === "arxiv" ? "arXiv" : "Crossref" }) : copy(provider.records === 1 ? "paperSearch.providerRecords.one" : "paperSearch.providerRecords.other", { provider: provider.name === "arxiv" ? "arXiv" : "Crossref", count: provider.records })}</li>)}</ul>}
    </div>
    {result && <><p className="mt-3 font-serif text-xs leading-relaxed text-ink-3">{copy("paperSearch.sampleNotice")}</p><div className="mt-4 grid gap-4 md:grid-cols-2">{result.groups.map(group => <PaperCard key={group.id} group={group} />)}</div></>}
  </section>;
}
