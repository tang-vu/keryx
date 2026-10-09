"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { RUN_SURFACES } from "@/lib/research/run-provenance";
import { historyPageSchema, historyQueryString, type HistoryInput, type HistoryPage } from "@/lib/history/personal-history";
import { personalHistoryCopy as copy } from "@/locales/en/personal-history";

export function CurrentHistoryPane() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy.checking}</p>;
  return session ? <CurrentHistoryView key={session.address.toLowerCase()} owner={session.address.toLowerCase()} /> : <p>{copy.signedOut}</p>;
}

/** Owner switch unmounts this component; late requests cannot publish an older wallet's rows. */
export function CurrentHistoryView({ owner }: { owner: string }) {
  const formId = useId();
  const [query, setQuery] = useState<HistoryInput>({ limit: 25 });
  const [cursors, setCursors] = useState<(string | undefined)[]>([]);
  const [pageResult, setPageResult] = useState<{ key: string; page: HistoryPage } | null>(null);
  const [statusResult, setStatusResult] = useState<{ key: string; status: "ready" | "changed" | "unavailable" } | null>(null);
  const [revision, setRevision] = useState(0);
  const requestKey = JSON.stringify({ owner, query, revision });
  const page = pageResult?.key === requestKey ? pageResult.page : null;
  const status = statusResult?.key === requestKey ? statusResult.status : "loading";
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/me/history?${historyQueryString(query)}`, { headers: { "X-Keryx-Expected-Wallet": owner }, cache: "no-store", signal: controller.signal });
        if (!response.ok) { if (active) setStatusResult({ key: requestKey, status: response.status === 409 ? "changed" : "unavailable" }); await response.body?.cancel(); return; }
        const result = historyPageSchema.parse(await readBoundedJson(response, 2 * 1024 * 1024));
        if (result.wallet !== owner) throw new Error("Owner mismatch");
        if (active) { setPageResult({ key: requestKey, page: result }); setStatusResult({ key: requestKey, status: "ready" }); }
      } catch { if (active) setStatusResult({ key: requestKey, status: "unavailable" }); }
    })();
    return () => { active = false; controller.abort(); };
  }, [owner, query, requestKey]);
  const inputClass = "min-h-11 w-full border border-line bg-paper px-3 text-sm";
  return <section className="space-y-5" aria-label={copy.title}>
    <p className="text-sm text-ink-2">{copy.scope}</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      const value = (key: string) => String(data.get(key) ?? "");
      const next: HistoryInput = { limit: 25 };
      if (value("search")) next.search = value("search");
      if (value("surface")) next.surface = value("surface") as HistoryInput["surface"];
      if (value("funding")) next.funding = value("funding") as HistoryInput["funding"];
      if (value("from")) next.from = `${value("from")}T00:00:00.000Z`;
      if (value("to")) next.to = `${value("to")}T23:59:59.999Z`;
      setCursors([]); setQuery(next);
    }}>
      <label className="sm:col-span-2">{copy.search}<input name="search" maxLength={200} className={inputClass} /></label>
      <div><label htmlFor={`${formId}-surface`}>{copy.surface}</label><select id={`${formId}-surface`} name="surface" className={inputClass}><option value="">{copy.all}</option>{RUN_SURFACES.map(surface => <option key={surface} value={surface}>{surface}</option>)}</select></div>
      <div><label htmlFor={`${formId}-funding`}>{copy.funding}</label><select id={`${formId}-funding`} name="funding" className={inputClass}><option value="">{copy.all}</option><option value="browser-recorded">{copy.browser}</option><option value="other-or-unknown">{copy.other}</option></select></div>
      <label>{copy.from}<input name="from" type="date" className={inputClass} /></label>
      <label>{copy.to}<input name="to" type="date" className={inputClass} /></label>
      <button className={inputClass} type="submit">{copy.apply}</button>
    </form>
    <div aria-live="polite">
      {status === "loading" && <p>{copy.loading}</p>}
      {status === "changed" && <p>{copy.changed}</p>}
      {status === "unavailable" && <div><p>{copy.unavailable}</p><button className={inputClass} onClick={() => setRevision(value => value + 1)}>{copy.retry}</button></div>}
      {status === "ready" && page?.rows.length === 0 && <p>{copy.empty}</p>}
    </div>
    {page && <>
      <ul className="divide-y divide-line">{page.rows.map(row => <li key={row.id} className="space-y-2 py-4">
        <Link className="break-words text-ink underline" href={`/dispatch/${row.id}`}>{row.question}</Link>
        <p className="text-xs text-ink-3">{row.createdAt} · {row.provenance?.surface ?? copy.unknown} · {row.funding === "browser-recorded" ? copy.browser : copy.other}</p>
        <p className="text-xs text-ink-2">{copy.recorded}: {row.recordedSpendUsdc} / {row.recordedCreatorAllocationUsdc} USDC · {row.paymentMode ?? copy.unknown}</p>
        <div className="flex gap-4 text-sm"><Link href={`/dispatch/${row.id}`}>{copy.report}</Link><a href={`/api/dispatch/${row.id}/receipt`}>{copy.receipt}</a></div>
      </li>)}</ul>
      <div className="flex gap-3">
        <button className={inputClass} disabled={!cursors.length} onClick={() => { const previous = cursors.at(-1); setCursors(values => values.slice(0, -1)); setQuery(value => ({ ...value, cursor: previous })); }}>{copy.newer}</button>
        <button className={inputClass} disabled={!page.nextCursor} onClick={() => { setCursors(values => [...values, query.cursor]); setQuery(value => ({ ...value, cursor: page.nextCursor! })); }}>{copy.older}</button>
      </div>
    </>}
  </section>;
}
