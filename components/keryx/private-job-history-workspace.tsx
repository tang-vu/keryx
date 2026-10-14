"use client";

import Link from "next/link";
import { ownedHistoryCopy } from "@/locales/en/owned-history";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import {
  PRIVATE_JOB_HISTORY_BOUNDS as B, PRIVATE_JOB_HISTORY_QUALIFICATION,
  privateJobHistoryInputSchema, privateJobHistoryDetailInputSchema,
  privateJobHistoryPageSchema, privateJobHistoryDetailSchema, privateJobHistoryExportSchema,
  comparePrivateJobPosition, privateJobTime,
  type PrivateJobHistoryInput, type PrivateJobHistoryPage, type PrivateJobHistoryRow,
  type PrivateJobHistoryDetail, type PrivateJobHistoryExport,
} from "@/lib/history/private-job-history-contract";
import { RUN_SURFACES } from "@/lib/research/run-provenance";
import { isOwnBrowserAuthChange } from "@/lib/browser-auth-notice";

const copy = ownedHistoryCopy.privateJobs;

const control = "border border-line px-3 py-2 text-sm disabled:opacity-40";
const unavailable = copy.errors.unavailable;
const accessMessages: Record<number, string> = {
  401: copy.errors.unauthorized,
  403: copy.errors.forbidden,
  409: copy.errors.changedSession,
};

/** Session object identity matters: a fresh same-wallet login/focus check is a new boundary.
 * Connector state can invalidate a view, but supplies no authenticated wallet authority. */
export function PrivateJobHistoryWorkspace() {
  const { session, address, isConnected, authState, refresh } = useSiweAuth();
  const current = useRef({ session, address, isConnected, authState, generation: 0 });
  const lifetime = useRef<AbortController | null>(null);
  const [mounted, setMounted] = useState(false);
  const [notice, setNotice] = useState("");
  const [fence, setFence] = useState({ session, address, isConnected, authState, generation: 0, waiting: false });
  // Reset the child during this render, including same-address session replacement.
  if (session !== fence.session || address !== fence.address || isConnected !== fence.isConnected || authState !== fence.authState) {
    setFence({ session, address, isConnected, authState, generation: fence.generation + 1, waiting: session === fence.session });
  }
  current.current = { session, address, isConnected, authState, generation: fence.generation };
  const invalidate = (message = "") => {
    lifetime.current?.abort();
    // Synchronous cancellation also fences responses whose transport ignores abort.
    current.current.generation++;
    setNotice(message);
    setFence(previous => ({ ...previous, generation: previous.generation + 1, waiting: true }));
  };
  useEffect(() => {
    setMounted(true);
    const changed = () => invalidate();
    const focused = (event: Event) => { if (event.target === event.currentTarget) changed(); };
    // Capture clears private state before the hook starts its ordinary refresh.
    window.addEventListener("keryx:auth", changed, true);
    window.addEventListener("focus", focused, true);
    let channel: BroadcastChannel | undefined;
    // The real hook orders logout snapshots and relays each accepted boundary
    // synchronously as keryx:auth. Ignore duplicate/late channel snapshots here.
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = event => {
      if (event?.data?.type !== "logout" && !isOwnBrowserAuthChange(event?.data)) changed();
    }; } catch { /* Local events/focus still invalidate. */ }
    return () => {
      lifetime.current?.abort();
      window.removeEventListener("keryx:auth", changed, true);
      window.removeEventListener("focus", focused, true);
      channel?.close();
    };
  }, []);
  const checkSignIn = () => { invalidate(); void refresh(); };
  if (!mounted || session === undefined) return <p role="status">{copy.auth.checking}</p>;
  if (!session) return <div>{notice && <p role="alert">{notice}</p>}<Link href="/connect" prefetch={false} className="underline">{copy.auth.signIn}</Link></div>;
  const wallet = typeof session.address === "string" ? session.address.toLowerCase() : "";
  if (!/^0x[a-f0-9]{40}$/.test(wallet) || authState !== "idle" || fence.waiting
    || (address !== undefined && address.toLowerCase() !== wallet)) return <div className="space-y-3">
    {notice && <p role="alert">{notice}</p>}
    <p role="status">{copy.auth.waiting}</p>
    <button type="button" className={control} disabled={authState !== "idle"} onClick={checkSignIn}>{copy.auth.check}</button>
  </div>;
  const generation = fence.generation;
  return <History key={generation} wallet={wallet} attach={controller => { lifetime.current = controller; }}
    current={() => current.current.session === session && current.current.address === address
      && current.current.isConnected === isConnected && current.current.authState === "idle" && current.current.generation === generation}
    accessLost={invalidate} />;
}

class PrivateReadError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Fetch bodies are decoded by the browser. Bound those bytes before fatal UTF-8/JSON parsing;
 * race both transport and streaming reads so an abort-ignoring response cannot publish. */
async function readJson(response: Response, maxBytes: number, signal: AbortSignal, check: () => void): Promise<unknown> {
  const length = response.headers.get("content-length");
  if (!/^application\/json(?:\s*;|\s*$)/i.test(response.headers.get("content-type") ?? "")
    || length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
    void response.body?.cancel().catch(() => undefined); throw new Error(unavailable);
  }
  if (!response.body) throw new Error(unavailable);
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, text = "";
  let reject!: (error: Error) => void;
  const stopped = new Promise<never>((_, fail) => { reject = fail; });
  void stopped.catch(() => undefined);
  const stop = () => { reject(new Error(unavailable)); void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (;;) {
      check();
      const part = await Promise.race([reader.read(), stopped]);
      check();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error(unavailable);
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    check();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener("abort", stop);
    void reader.cancel().catch(() => undefined);
    // A cancelled pending read need not have settled yet.
    try { reader.releaseLock(); } catch { /* Cancellation owns the pending read. */ }
  }
}

function checkRows(rows: PrivateJobHistoryRow[], filters: PrivateJobHistoryInput) {
  const seen = new Set<string>();
  let previous: { id: string; createdAt: string } | undefined;
  for (const row of rows) {
    if (seen.has(row.id) || row.intentCreatedAt === null) throw new Error(unavailable);
    seen.add(row.id);
    const position = { id: row.id, createdAt: row.intentCreatedAt };
    if (previous && comparePrivateJobPosition(position, previous) >= 0) throw new Error(unavailable);
    previous = position;
    if (filters.search && !row.question.includes(filters.search)
      || filters.surface && (row.provenance?.surface ?? "unknown") !== filters.surface
      || filters.network && row.incomingSettlement.network !== filters.network
      || filters.from && privateJobTime(position.createdAt) < privateJobTime(filters.from)
      || filters.to && privateJobTime(position.createdAt) > privateJobTime(filters.to)) throw new Error(unavailable);
  }
}
function checkCursor(cursor: string | null) {
  if (cursor !== null) privateJobHistoryInputSchema.parse({ cursor });
}
function micros(value: string) {
  const padded = value.padStart(7, "0");
  return `${padded.slice(0, -6)}.${padded.slice(-6)} USDC`;
}
function csv(value: PrivateJobHistoryExport) {
  const cell = (value: unknown) => {
    const raw = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
    return `"${(/^[\s\uFEFF]*[=+\-@]/u.test(raw) ? `'${raw}` : raw).replaceAll('"', '""')}"`;
  };
  const fields = ["id", "createdAt", "intentCreatedAt", "savedAt", "question", "researchMode", "model", "provenance", "incomingSettlement", "ownSettledSpendMicros", "creatorRewardsMicros", "paidCreators"] as const;
  return [["record", ...fields], ["metadata", JSON.stringify({ wallet: value.wallet, scope: value.scope,
    complete: value.complete, truncated: value.truncated, nextCursor: value.nextCursor, bounds: value.bounds,
    capabilities: value.capabilities, qualification: value.qualification }), ...Array(fields.length - 1).fill("")],
  ...value.rows.map(row => [row.record, ...fields.map(field => row[field])])].map(line => line.map(cell).join(",")).join("\r\n") + "\r\n";
}

function History({ wallet, attach, current, accessLost }: {
  wallet: string; attach(controller: AbortController): void; current(): boolean; accessLost(message: string): void;
}) {
  const life = useRef<AbortController | null>(null);
  const requests = useRef(new Map<string, AbortController>());
  const actionVersion = useRef(0);
  const [page, setPage] = useState<PrivateJobHistoryPage | null>(null);
  const [detail, setDetail] = useState<PrivateJobHistoryDetail | null>(null);
  const [selected, setSelected] = useState<PrivateJobHistoryRow | null>(null);
  const [busy, setBusy] = useState<string | null>("list");
  const [error, setError] = useState("");
  const [download, setDownload] = useState("");
  const [filters, setFilters] = useState<PrivateJobHistoryInput>({ limit: 25 });
  const [form, setForm] = useState({ search: "", surface: "", network: "", from: "", to: "" });
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [request, setRequest] = useState({ filters: { limit: 25 } as PrivateJobHistoryInput, cursor: undefined as string | undefined, revision: 0 });
  const live = () => life.current !== null && !life.current.signal.aborted && current();

  useEffect(() => {
    const controller = new AbortController(); life.current = controller; attach(controller);
    return () => { controller.abort(); requests.current.forEach(request => request.abort()); requests.current.clear(); };
  }, []);

  async function post<T>(action: "list" | "detail" | "export", body: unknown, parse: (raw: unknown) => T): Promise<T> {
    const parent = life.current;
    if (!parent || parent.signal.aborted || !current()) throw new Error(unavailable);
    requests.current.get(action)?.abort();
    const controller = new AbortController(); requests.current.set(action, controller);
    const cancel = () => controller.abort(); parent.signal.addEventListener("abort", cancel, { once: true });
    const duration = action === "export" ? B.exportMs : B.readMs, deadline = Date.now() + duration;
    const timer = setTimeout(cancel, duration);
    const check = () => { if (controller.signal.aborted || parent.signal.aborted || !current() || Date.now() >= deadline) throw new Error(unavailable); };
    let reject!: (error: Error) => void;
    const stopped = new Promise<never>((_, fail) => { reject = fail; }); void stopped.catch(() => undefined);
    const stop = () => reject(new Error(unavailable)); controller.signal.addEventListener("abort", stop, { once: true });
    try {
      check();
      const serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).byteLength > B.requestBytes) throw new Error("Filters are too large.");
      const response = await Promise.race([fetch(action === "list" ? "/api/me/private-jobs" : `/api/me/private-jobs/${action}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: controller.signal,
        headers: { "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallet }, body: serialized,
      }), stopped]);
      check();
      if (!response.ok) throw new PrivateReadError(response.status, accessMessages[response.status]
        ?? (response.status === 404 ? copy.errors.missingResult : unavailable));
      const parsed = parse(await readJson(response, action === "export" ? B.exportBytes : action === "detail" ? B.detailBytes : B.pageBytes, controller.signal, check));
      check(); return parsed;
    } finally {
      clearTimeout(timer); parent.signal.removeEventListener("abort", cancel); controller.signal.removeEventListener("abort", stop);
      controller.abort();
      if (requests.current.get(action) === controller) requests.current.delete(action);
    }
  }
  function failed(error: unknown) {
    if (!live()) return;
    const message = error instanceof PrivateReadError ? error.message : unavailable;
    setPage(null); setSelected(null); setDetail(null); setDownload(""); setError(message);
    if (error instanceof PrivateReadError && accessMessages[error.status]) accessLost(message);
  }
  useEffect(() => {
    let active = true; setBusy("list"); setPage(null); setSelected(null); setDetail(null); setError(""); setDownload("");
    requests.current.get("detail")?.abort(); requests.current.get("export")?.abort();
    void post("list", privateJobHistoryInputSchema.parse({ ...request.filters, ...(request.cursor ? { cursor: request.cursor } : {}) }), raw => {
      const parsed = privateJobHistoryPageSchema.parse(raw);
      if (parsed.wallet !== wallet || parsed.rows.length > (request.filters.limit ?? 25) || parsed.rows.length > parsed.scannedIntents
        || parsed.scanLimited && !parsed.nextCursor || parsed.nextCursor === request.cursor) throw new Error(unavailable);
      checkCursor(parsed.nextCursor); checkRows(parsed.rows, request.filters); return parsed;
    }).then(value => { if (active && live()) setPage(value); }).catch(error => { if (active) failed(error); })
      .finally(() => { if (active && live()) setBusy(null); });
    return () => { active = false; requests.current.get("list")?.abort(); };
  }, [request]);

  function load(nextFilters: PrivateJobHistoryInput, cursor: string | undefined, trail: (string | undefined)[]) {
    actionVersion.current++;
    requests.current.forEach(controller => controller.abort());
    setBusy("list"); setFilters(nextFilters); setCursors(trail);
    setRequest(previous => ({ filters: nextFilters, cursor, revision: previous.revision + 1 }));
  }
  function apply() {
    if (busy) return;
    const parsed = privateJobHistoryInputSchema.safeParse({ limit: 25, ...Object.fromEntries(Object.entries(form).filter(([, value]) => value !== "")) });
    if (!parsed.success) { setError(copy.errors.invalidFilters); return; }
    load(parsed.data, undefined, [undefined]);
  }
  async function open(row: PrivateJobHistoryRow) {
    if (busy) return;
    const version = ++actionVersion.current;
    setBusy("detail"); setError(""); setSelected(row); setDetail(null); setDownload("");
    try {
      const value = await post("detail", privateJobHistoryDetailInputSchema.parse({ id: row.id }), raw => {
        const parsed = privateJobHistoryDetailSchema.parse(raw);
        // Detail intentionally has no list timestamp; every other recorded field must match.
        const { intentCreatedAt: ignoredListTime, ...expected } = row;
        const { intentCreatedAt: ignoredDetailTime, ...actual } = parsed.row;
        void ignoredListTime; void ignoredDetailTime;
        if (parsed.wallet !== wallet || parsed.row.id !== row.id || parsed.row.intentCreatedAt !== null || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(unavailable);
        return parsed;
      });
      if (live() && version === actionVersion.current) setDetail(value);
    } catch (error) { if (version === actionVersion.current) failed(error); }
    finally { if (live() && version === actionVersion.current) setBusy(null); }
  }
  async function exportHistory(format: "json" | "csv") {
    if (busy) return;
    const version = ++actionVersion.current;
    setBusy("export"); setError(""); setDownload("");
    try {
      // Both downloads use the schema-bearing JSON endpoint. CSV is encoded locally only
      // after exact wallet/schema validation; no unverified CSV response is downloaded.
      const value = await post("export", { ...privateJobHistoryInputSchema.parse(filters), format: "json" }, raw => {
        const parsed = privateJobHistoryExportSchema.parse(raw);
        if (parsed.wallet !== wallet || parsed.rows.length > parsed.pages * (filters.limit ?? 25)) throw new Error(unavailable);
        checkCursor(parsed.nextCursor); checkRows(parsed.rows, filters); return parsed;
      });
      const text = format === "json" ? JSON.stringify(value) : csv(value);
      if (new TextEncoder().encode(text).byteLength > B.exportBytes) throw new Error(unavailable);
      if (!live() || version !== actionVersion.current) return;
      const url = URL.createObjectURL(new Blob([text], { type: format === "json" ? "application/json" : "text/csv;charset=utf-8" }));
      try {
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `keryx-private-job-history.${format}`;
        anchor.click(); // Never mount or retain a private download link in the DOM.
      } finally { URL.revokeObjectURL(url); }
      if (live() && version === actionVersion.current) setDownload(value.truncated ? copy.download.truncated({ rows: value.rows.length })
        : copy.download.complete({ rows: value.rows.length }));
    } catch (error) { if (version === actionVersion.current) failed(error); }
    finally { if (live() && version === actionVersion.current) setBusy(null); }
  }

  return <div className="space-y-5">
    <p className="break-all font-mono text-xs">{copy.auth.payer({ wallet })}</p>
    <p className="text-sm text-ink-3">{PRIVATE_JOB_HISTORY_QUALIFICATION}</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); apply(); }}>
      <label className="text-sm">{copy.filters.question}<input className="mt-1 block w-full border border-line bg-paper p-2" maxLength={200} value={form.search} onChange={event => setForm(previous => ({ ...previous, search: event.target.value }))} /></label>
      <label className="text-sm">{copy.filters.surface}<select className="mt-1 block w-full border border-line bg-paper p-2" value={form.surface} onChange={event => setForm(previous => ({ ...previous, surface: event.target.value }))}>
        <option value="">{copy.filters.allSurfaces}</option>{RUN_SURFACES.map(surface => <option key={surface} value={surface}>{surface === "unknown" ? copy.row.unknownLegacy : surface}</option>)}
      </select></label>
      <label className="text-sm">{copy.filters.network}<select className="mt-1 block w-full border border-line bg-paper p-2" value={form.network} onChange={event => setForm(previous => ({ ...previous, network: event.target.value }))}>
        <option value="">{copy.filters.allNetworks}</option><option value="eip155:5042">{copy.filters.arcNetwork}</option><option value="eip155:5042002">{copy.filters.testnetNetwork}</option>
      </select></label>
      {(["from", "to"] as const).map(name => <label key={name} className="text-sm">{name === "from" ? copy.filters.from : copy.filters.to}<input className="mt-1 block w-full border border-line bg-paper p-2" placeholder={copy.filters.dateExample} maxLength={32} value={form[name]} onChange={event => setForm(previous => ({ ...previous, [name]: event.target.value }))} /></label>)}
      <div className="flex flex-wrap items-end gap-2"><button type="submit" disabled={!!busy} className={control}>{copy.actions.apply}</button>
        <button type="button" disabled={!!busy} className={control} onClick={() => load(filters, undefined, [undefined])}>{copy.actions.refresh}</button></div>
    </form>
    <p className="text-xs text-ink-3">{copy.filters.scope}</p>
    {busy && <p role="status">{busy === "list" ? copy.status.list : busy === "detail" ? copy.status.detail : copy.status.export}</p>}
    {error && <p role="alert">{error}</p>}
    {page && <section aria-label={copy.scan.section} className="space-y-3">
      <p>{copy.scan.summary({ page: cursors.length, rows: page.rows.length, intents: page.scannedIntents })}</p>
      <p className="text-sm">{page.nextCursor ? (page.scanLimited ? copy.scan.limited : copy.scan.more) : copy.scan.exhausted}</p>
      {page.rows.length === 0 && <p>{page.nextCursor ? copy.scan.emptyPage : copy.scan.emptyStore}</p>}
      <ul className="divide-y divide-line">{page.rows.map(row => <li key={row.id} className="space-y-2 py-4">
        <p className="break-words font-serif">{row.question}</p><RowFacts row={row} />
        <button type="button" disabled={!!busy} className={control} onClick={() => { void open(row); }}>{copy.actions.view}</button>
      </li>)}</ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={control} disabled={!!busy || cursors.length === 1} onClick={() => { const trail = cursors.slice(0, -1); load(filters, trail[trail.length - 1], trail); }}>{copy.actions.previous}</button>
        <button type="button" className={control} disabled={!!busy || !page.nextCursor || cursors.length >= B.exportPages} onClick={() => {
          if (!page.nextCursor || cursors.includes(page.nextCursor)) { failed(new Error(unavailable)); return; }
          load(filters, page.nextCursor, [...cursors, page.nextCursor]);
        }}>{copy.actions.next}</button>
      </div>
      {cursors.length >= B.exportPages && page.nextCursor && <p>{copy.scan.navigationBound}</p>}
      <div className="flex flex-wrap gap-2"><button type="button" disabled={!!busy} className={control} onClick={() => { void exportHistory("json"); }}>{copy.actions.json}</button>
        <button type="button" disabled={!!busy} className={control} onClick={() => { void exportHistory("csv"); }}>{copy.actions.csv}</button></div>
      <p className="text-xs">{copy.download.scope}</p>
    </section>}
    {download && <p role="status">{download}</p>}
    {selected && <section aria-label={copy.detail.section} className="space-y-4 border-t border-line pt-5">
      <button type="button" className={control} disabled={!!busy && busy !== "detail"} onClick={() => { actionVersion.current++; requests.current.get("detail")?.abort(); setSelected(null); setDetail(null); setBusy(null); }}>{copy.actions.close}</button>
      {detail && <><h2 className="break-words font-serif text-xl">{detail.row.question}</h2><RowFacts row={detail.row} />
        <p className="text-sm">{copy.detail.introduction({ engine: detail.result.engine, savedAt: detail.result.savedAt })}</p>
        <pre className="whitespace-pre-wrap break-words font-sans text-sm">{detail.result.answer}</pre>
        {detail.result.subClaims.length > 0 && <div><h3 className="font-serif">{copy.detail.claims}</h3><ul className="list-disc pl-5">{detail.result.subClaims.map((claim, index) => <li key={index} className="break-words">{claim}</li>)}</ul></div>}
        <div><h3 className="font-serif">{copy.detail.citations}</h3>{detail.result.citations.length === 0 ? <p>{copy.detail.noCitations}</p> : <ul className="space-y-2">{detail.result.citations.map((citation, index) => <li key={index} className="break-words">{copy.detail.citation({ marker: citation.marker, sourceName: citation.sourceName, itemTitle: citation.itemTitle, rationale: citation.rationale, recordedRewardUsdc: citation.recordedRewardUsdc })}</li>)}</ul>}</div>
        <div><h3 className="font-serif">{copy.detail.decisions}</h3><ul className="space-y-2">{detail.result.decisions.map((decision, index) => <li key={index} className="break-words">{copy.detail.decision({ action: decision.action, sourceName: decision.sourceName, rationale: decision.rationale, price: decision.price })}</li>)}</ul></div>
        <p className="text-sm">{copy.detail.summary({ evidence: detail.result.evidence === null ? copy.detail.unavailableLegacy : copy.detail.evidenceCount({ count: detail.result.evidence.length }), coverage: detail.result.claimCoverage === null ? copy.detail.unavailableLegacy : copy.detail.coverageCount({ count: detail.result.claimCoverage.length }) })}</p>
        {detail.result.evidence !== null && <details><summary>{copy.detail.evidenceExcerpts}</summary><ul className="mt-3 space-y-3">{detail.result.evidence.map((evidence, index) => <li key={index} className="break-words">
          <p>{evidence.marker} {evidence.sourceName}: {evidence.claim}</p><blockquote className="whitespace-pre-wrap border-l border-line pl-3">{evidence.quote}</blockquote>
          <p className="text-xs">{copy.detail.support({ support: evidence.support, qualifiesForReward: String(evidence.qualifiesForReward) })}</p>
        </li>)}</ul></details>}
        {detail.result.claimCoverage !== null && <details><summary>{copy.detail.claimCoverage}</summary><ul className="mt-3 space-y-2">{detail.result.claimCoverage.map((coverage, index) => <li key={index} className="break-words">{copy.detail.coverage({ claim: coverage.claim, coverage: coverage.coverage, markers: coverage.coveredBy.join(", ") || copy.detail.noMarkers })}</li>)}</ul></details>}
      </>}
    </section>}
  </div>;
}

function RowFacts({ row }: { row: PrivateJobHistoryRow }) {
  return <div className="space-y-1 text-sm text-ink-3">
    <p>{copy.row.completion({ createdAt: row.createdAt, savedAt: row.savedAt, researchMode: row.researchMode, model: row.model ?? copy.row.unknownLegacy })}</p>
    <p>{copy.row.provenance({ network: row.incomingSettlement.network, surface: row.provenance?.surface ?? copy.row.unknownLegacy, ownershipMethod: row.provenance?.ownershipMethod ?? copy.row.unknownLegacy })}</p>
    <p>{copy.row.incoming({ amount: micros(row.incomingSettlement.amountMicros), evidenceSource: row.incomingSettlement.evidenceSource })}</p>
    <p>{copy.row.unavailableSettlement}</p>
  </div>;
}
