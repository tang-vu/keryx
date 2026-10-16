"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { RUN_SURFACES } from "@/lib/research/run-provenance";
import { ownedInputSchema, ownedPageSchema, type OwnedHistoryInput, type OwnedHistoryPage, type OwnedHistoryRow } from "@/lib/history/owned-history";
import { formatUsdcMicros } from "@/lib/display/recorded-usdc";
import { ownedHistoryCopy as copy } from "@/locales/en/owned-history";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


export function OwnedHistoryPane() {
  const copy = useUiCopy("owned-history", uiEnglish_copy);
  const { session } = useSiweAuth();
  return session === undefined ? <p role="status">{copy.checking}</p> : session
    ? <OwnedHistoryView key={session.address.toLowerCase()} owner={session.address.toLowerCase()} /> : <p>{copy.signedOut}</p>;
}
const queryString = (input: OwnedHistoryInput) => new URLSearchParams(Object.entries(ownedInputSchema.parse(input)).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])).toString();
/** Unmount/abort and owner precondition fence late reads, downloads and mutations. */
export function OwnedHistoryView({ owner }: { owner: string }) {
  const copy = useUiCopy("owned-history", uiEnglish_copy);
  const formId = useId(), controller = useRef<AbortController | null>(null);
  // Each effect controller identifies one owner/filter/revision generation.
  const isCurrent = useCallback((abort: AbortController | null): abort is AbortController =>
    abort !== null && controller.current === abort && !abort.signal.aborted, []);
  const [query, setQuery] = useState<OwnedHistoryInput>({ limit: 25 }), [past, setPast] = useState<(string | undefined)[]>([]);
  const [revision, setRevision] = useState(0), [result, setResult] = useState<{ key: string; page: OwnedHistoryPage } | null>(null);
  const [failure, setFailure] = useState<string | null>(null), [report, setReport] = useState<{ key: string; id: string; answer: string } | null>(null);
  const key = JSON.stringify({ owner, query, revision }), page = result?.key === key ? result.page : null;
  useEffect(() => {
    const abort = new AbortController(); controller.current = abort;
    void (async () => {
      try {
        const response = await fetch(`/api/me/asks?contract=owned&${queryString(query)}`, { headers: { "X-Keryx-Expected-Wallet": owner }, cache: "no-store", signal: abort.signal });
        if (!isCurrent(abort)) { await response.body?.cancel(); return; }
        if (!response.ok) { await response.body?.cancel(); throw new Error("Refused"); }
        const value = ownedPageSchema.parse(await readBoundedJson(response, 2 * 1024 * 1024));
        if (value.wallet !== owner) throw new Error("Owner changed");
        if (isCurrent(abort)) { setResult({ key, page: value }); setFailure(null); setReport(null); }
      } catch { if (isCurrent(abort)) setFailure(copy.unavailable); }
    })();
    return () => { abort.abort(); if (controller.current === abort) controller.current = null; };
  }, [owner, query, key, isCurrent]);
  async function read(url: string, abort: AbortController | null) {
    if (!isCurrent(abort)) throw new Error("Stale owner");
    const response = await fetch(url, { headers: { "X-Keryx-Expected-Wallet": owner }, cache: "no-store", redirect: "error", signal: abort.signal });
    if (!isCurrent(abort)) { await response.body?.cancel(); throw new Error("Stale owner"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error("Refused"); }
    return response;
  }
  async function download(url: string, name: string) {
    const abort = controller.current;
    try {
      const response = await read(url, abort);
      // Server bounds exports; enforce a browser bound too before creating a download.
      const reader = response.body?.getReader(); if (!reader) throw new Error("No download");
      const chunks: Uint8Array<ArrayBuffer>[] = []; let size = 0;
      try { for (;;) { const part = await reader.read(); if (!isCurrent(abort)) return; if (part.done) break; size += part.value.length; if (size > 8 * 1024 * 1024) throw new Error("Too large"); chunks.push(new Uint8Array(part.value)); } }
      finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      if (!isCurrent(abort)) return;
      const href = URL.createObjectURL(new Blob(chunks)), anchor = document.createElement("a"); anchor.href = href; anchor.download = name;
      try { anchor.click(); } finally { URL.revokeObjectURL(href); }
    } catch { if (isCurrent(abort)) setFailure(copy.failed); }
  }
  async function openReport(row: OwnedHistoryRow) {
    const abort = controller.current;
    try {
      const response = await read(row.links.report, abort);
      const value = z.object({ wallet: z.literal(owner), run: z.object({ id: z.literal(row.id), answer: z.string().max(4_000_000) }).passthrough() }).passthrough().parse(await readBoundedJson(response, 4 * 1024 * 1024));
      if (isCurrent(abort)) setReport({ key, id: row.id, answer: value.run.answer });
    } catch { if (isCurrent(abort)) setFailure(copy.failed); }
  }
  async function mutate(row: OwnedHistoryRow, visibility?: string) {
    const abort = controller.current;
    if (row.ownerWallet !== owner || !isCurrent(abort)) return;
    if (visibility === undefined && !window.confirm(copy.confirmErase)) return;
    try {
      const response = await fetch(row.links.privacy, { method: visibility === undefined ? "DELETE" : "PATCH", signal: abort.signal,
        headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": owner },
        body: JSON.stringify({ ...(visibility ? { visibility } : {}), revision: row.revision, requestId: crypto.randomUUID() }) });
      await response.body?.cancel(); if (!response.ok) throw new Error("Refused");
      if (isCurrent(abort)) { setReport(null); setRevision(v => v + 1); }
    } catch { if (isCurrent(abort)) setFailure(copy.failed); }
  }
  const button = "min-h-11 border border-line px-3 text-sm", inputClass = "min-h-11 w-full border border-line bg-paper px-3";
  return <section className="space-y-5" aria-label={copy.title}>
    <h2>{copy.title}</h2><p>{copy.scope}</p>
    {page && !page.membershipAvailable && <p>{copy.walletOnly}</p>}{page && !page.claimsAvailable && <p>{copy.claimsMissing}</p>}
    <form id={formId} className="grid gap-3 sm:grid-cols-2" onSubmit={e => {
      e.preventDefault(); const data = new FormData(e.currentTarget), raw: Record<string, unknown> = { limit: 25 };
      for (const name of ["search", "surface", "network", "funding", "visibility"]) { const value = String(data.get(name) ?? ""); if (value) raw[name] = value; }
      for (const name of ["from", "to"]) { const value = String(data.get(name) ?? ""); if (value) raw[name] = `${value}T${name === "from" ? "00:00:00.000" : "23:59:59.999"}Z`; }
      const next = ownedInputSchema.safeParse(raw); if (!next.success) { setFailure(copy.failed); return; }
      setPast([]); setReport(null); setQuery(next.data);
    }}>
      <label>{copy.search}<input name="search" maxLength={200} className={inputClass} /></label>
      {[["surface", copy.surface, RUN_SURFACES], ["network", copy.network, ["eip155:5042", "eip155:5042002", "unknown"]],
        ["funding", copy.funding, ["paid", "sponsored", "mixed", "unknown"]], ["visibility", copy.visibility, ["private", "unlisted", "public"]]].map(([name,label,options]) =>
        <label key={String(name)}>{String(label)}<select name={String(name)} className={inputClass}><option value="">{copy.all}</option>{(options as readonly string[]).map(value => <option key={value}>{value}</option>)}</select></label>)}
      <label>{copy.from}<input name="from" type="date" className={inputClass} /></label><label>{copy.to}<input name="to" type="date" className={inputClass} /></label>
      <button className={button}>{copy.apply}</button>
    </form>
    <p>{copy.exportScope}</p><div className="flex flex-wrap gap-3">
      <button className={button} onClick={() => { const { cursor: _cursor, ...filters } = query; void download(`/api/me/asks/export?${queryString(filters)}`, "keryx-history.json"); }}>{copy.exportJson}</button>
      <button className={button} onClick={() => { const { cursor: _cursor, ...filters } = query; void download(`/api/me/asks/export?format=csv&${queryString(filters)}`, "keryx-history.csv"); }}>{copy.exportCsv}</button>
      <button className={button} onClick={() => setRevision(v => v + 1)}>{copy.refresh}</button>
    </div>
    {failure && <p role="alert">{failure}</p>}{!page && !failure && <p role="status">{copy.checking}</p>}
    {page?.rows.length === 0 && <p>{copy.empty}</p>}{page?.scanLimited && <p>{copy.scanLimited}</p>}
    {page?.rows.map(row => <article key={row.id} className="space-y-3 border border-line p-4">
      <h3>{row.question}</h3><p>{row.createdAt} · {row.provenance?.surface ?? copy.unknown} · {row.ownership.method} · {row.visibility} · {row.funding}</p>
      <p>{copy.own}: {row.ownSettledSpendMicros === null ? copy.unknown : formatUsdcMicros(row.ownSettledSpendMicros)} · {copy.sponsored}: {row.sponsoredSettledSpendMicros === null ? copy.unknown : formatUsdcMicros(row.sponsoredSettledSpendMicros)}</p>
      {row.receiptsTruncated && <p>{copy.receiptBound}</p>}<p>{copy.paidCreators}</p><ul>{row.paidCreators.map((c,i) => <li key={i}>{c.name} · {formatUsdcMicros(c.amountMicros)} · {c.network} · {c.reference}</li>)}</ul>
      <div className="flex flex-wrap gap-3"><button className={button} onClick={() => void openReport(row)}>{copy.report}</button>
        <button className={button} onClick={() => void download(row.links.receipts, `${row.id}-receipts.json`)}>{copy.receipts}</button>
        <button className={button} onClick={() => void download(row.links.references, `${row.id}.bib`)}>{copy.references}</button></div>
      {row.ownerWallet === owner ? <form className="flex gap-3" onSubmit={e => { e.preventDefault(); void mutate(row, String(new FormData(e.currentTarget).get("visibility"))); }}>
        <label>{copy.visibility}<select name="visibility" defaultValue={row.visibility} className={inputClass}>{["private", "unlisted", "public"].map(v => <option key={v}>{v}</option>)}</select></label>
        <button className={button}>{copy.save}</button><button type="button" className={button} onClick={() => void mutate(row)}>{copy.erase}</button>
      </form> : <p>{copy.memberReadOnly}</p>}
    </article>)}
    {report?.key === key && <section aria-label={copy.report}><button className={button} onClick={() => setReport(null)}>{copy.close}</button><pre className="whitespace-pre-wrap">{report.answer}</pre></section>}
    <div className="flex gap-3"><button className={button} disabled={!past.length} onClick={() => { const cursor = past.at(-1); setPast(v => v.slice(0,-1)); setQuery(v => ({ ...v, cursor })); }}>{copy.previous}</button>
      <button className={button} disabled={!page?.nextCursor} onClick={() => { if (!page?.nextCursor) return; setPast(v => [...v,query.cursor]); setQuery(v => ({ ...v,cursor:page.nextCursor! })); }}>{copy.next}</button></div>
  </section>;
}
