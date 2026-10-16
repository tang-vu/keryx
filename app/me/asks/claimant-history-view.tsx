"use client";

import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { readBoundedJson } from "@/lib/read-bounded-json";

import { CLAIMANT_HISTORY_DETAIL_MAX_BYTES, parseClaimantHistoryDetail, parseClaimantHistoryPage, type ClaimantHistoryDetail,
  type ClaimantHistoryPage, type ClaimantHistoryRow, type HistoryDisplayIdentity } from "./claimant-history-contract";
import { useUiMessages } from "@/lib/i18n/ui-copy";




const buttonClass = "min-h-11 border border-line px-4 text-sm";
type ReadState<T> = { key: string; status: "ready"; value: T } | { key: string; status: "unavailable" | "changed" | "signed-out" };
const failure = (status: number) => status === 409 ? "changed" : status === 401 ? "signed-out" : "unavailable";

export function ClaimantHistoryPane() {
  const message = useUiMessages();
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{message("claimantHistory.checking")}</p>;
  if (!session || !/^0x[0-9a-fA-F]{40}$/.test(session.address)) return <p role="status">{message("claimantHistory.signedOut")}</p>;
  // Session.address comes from the existing server session lookup, never wagmi's
  // connected wallet. The server reauthenticates every request independently.
  const owner = session.address.toLowerCase(), network = browserPaymentProfile().networkId;
  return <ClaimantHistoryView key={`${owner}:${network}`} owner={owner} network={network} />;
}

export function ClaimantHistoryView({ owner, network }: { owner: string; network: string }) {
  const message = useUiMessages();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<ReadState<ClaimantHistoryPage> | null>(null);
  const [selected, setSelected] = useState<ClaimantHistoryRow | null>(null);
  const cursor = cursors.at(-1);
  const requestKey = JSON.stringify({ owner, network, cursor, revision });
  const current = result?.key === requestKey ? result : null;
  const page = current?.status === "ready" ? current.value : null;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    const identity = { owner, network, origin: window.location.origin };
    const params = new URLSearchParams({ limit: "25" }); if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const response = await fetch(`/api/me/run-history?${params}`, { method: "GET", credentials: "same-origin", redirect: "error",
          headers: { "X-Keryx-Expected-Wallet": owner }, cache: "no-store", signal: controller.signal });
        if (!response.ok) { if (active) setResult({ key: requestKey, status: failure(response.status) }); await response.body?.cancel(); return; }
        const value = parseClaimantHistoryPage(await readBoundedJson(response, 2 * 1024 * 1024), identity);
        if (value.nextCursor && cursors.includes(value.nextCursor)) throw new Error("Repeated history cursor");
        if (active && !controller.signal.aborted) setResult({ key: requestKey, status: "ready", value });
      } catch { if (active) setResult({ key: requestKey, status: "unavailable" }); }
      finally { clearTimeout(deadline); }
    })();
    return () => { active = false; clearTimeout(deadline); controller.abort(); };
  }, [owner, network, cursor, revision, requestKey, cursors]);
  const reset = () => { setSelected(null); setCursors([undefined]); setRevision(value => value + 1); };
  return <section className="space-y-5" aria-label={message("claimantHistory.title")}>
    <p className="text-sm text-ink-2">{message("claimantHistory.scope")}</p>
    <p className="text-sm text-ink-2">{message("claimantHistory.authority")}</p>
    <div aria-live="polite">
      {!current && <p>{message("claimantHistory.loading")}</p>}
      {current?.status === "changed" && <p>{message("claimantHistory.changed")}</p>}
      {current?.status === "signed-out" && <p>{message("claimantHistory.signedOut")}</p>}
      {current?.status === "unavailable" && <p>{message("claimantHistory.unavailable")}</p>}
      {page?.rows.length === 0 && <p>{message("claimantHistory.empty")}</p>}
    </div>
    <button type="button" className={buttonClass} onClick={reset}>{message("claimantHistory.refresh")}</button>
    {page && <>
      <p className="text-xs text-ink-3">{message(page.rows.length === 1 ? "claimantHistory.rows.one" : "claimantHistory.rows.other", { count: page.rows.length })}</p>
      <ul className="divide-y divide-line">{page.rows.map(row => <li key={row.id} className="space-y-2 py-4">
        <p className="break-words font-serif">{row.question}</p>
        <p className="text-xs text-ink-3">{message("claimantHistory.createdAt", { date: row.createdAt })}</p>
        <OwnershipLabel ownership={row.ownership} />
        <button type="button" className={buttonClass} onClick={() => setSelected(row)}>{message("claimantHistory.read")}</button>
      </li>)}</ul>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={buttonClass} disabled={cursors.length <= 1} onClick={() => { setSelected(null); setCursors(values => values.slice(0, -1)); }}>{message("claimantHistory.newer")}</button>
        <button type="button" className={buttonClass} disabled={!page.nextCursor || cursors.length >= 40} onClick={() => { setSelected(null); setCursors(values => [...values, page.nextCursor!]); }}>{message("claimantHistory.older")}</button>
      </div>
      {cursors.length >= 40 && <p>{message("claimantHistory.pageLimit")}</p>}
      {selected && <ClaimantHistorySavedRun key={`${requestKey}:${selected.id}`} identity={{ owner, network, origin: typeof window === "undefined" ? "" : window.location.origin }} selected={selected} close={() => setSelected(null)} />}
    </>}
  </section>;
}

function OwnershipLabel({ ownership }: { ownership: ClaimantHistoryRow["ownership"] }) {
  const message = useUiMessages();
  return <p className="text-xs text-ink-2">{ownership.method === "claimed" ? message("claimantHistory.claimed") : message("claimantHistory.recorded")}
    {ownership.method === "claimed" && <> · {message("claimantHistory.claimedAt", { date: ownership.claimedAt })}</>}
  </p>;
}

function ClaimantHistorySavedRun({ identity, selected, close }: { identity: HistoryDisplayIdentity; selected: ClaimantHistoryRow; close(): void }) {
  const message = useUiMessages();
  const { owner, network, origin } = identity;
  const requestKey = JSON.stringify({ owner, network, origin, id: selected.id });
  const [result, setResult] = useState<ReadState<ClaimantHistoryDetail> | null>(null);
  const current = result?.key === requestKey ? result : null;
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    const deadline = setTimeout(() => controller.abort(), 10_000);
    void (async () => {
      try {
        const response = await fetch(`/api/me/run-history/${encodeURIComponent(selected.id)}`, { method: "GET", credentials: "same-origin", redirect: "error",
          headers: { "X-Keryx-Expected-Wallet": owner }, cache: "no-store", signal: controller.signal });
        if (!response.ok) { if (active) setResult({ key: requestKey, status: failure(response.status) }); await response.body?.cancel(); return; }
        const value = parseClaimantHistoryDetail(await readBoundedJson(response, CLAIMANT_HISTORY_DETAIL_MAX_BYTES), { owner, network, origin }, selected);
        if (active && !controller.signal.aborted) setResult({ key: requestKey, status: "ready", value });
      } catch { if (active) setResult({ key: requestKey, status: "unavailable" }); }
      finally { clearTimeout(deadline); }
    })();
    return () => { active = false; clearTimeout(deadline); controller.abort(); };
  }, [owner, network, origin, selected, requestKey]);
  return <section className="space-y-3 border border-line p-4" aria-label={message("claimantHistory.answer")}>
    <button type="button" className={buttonClass} onClick={close}>{message("claimantHistory.closeDetail")}</button>
    <div aria-live="polite">
      {!current && <p>{message("claimantHistory.detailLoading")}</p>}
      {current?.status === "changed" && <p>{message("claimantHistory.changed")}</p>}
      {current?.status === "signed-out" && <p>{message("claimantHistory.signedOut")}</p>}
      {current?.status === "unavailable" && <p>{message("claimantHistory.detailUnavailable")}</p>}
    </div>
    {current?.status === "ready" && <>
      <h2 className="break-words font-serif">{current.value.run.question}</h2>
      <OwnershipLabel ownership={current.value.ownership} />
      <p className="text-xs text-ink-3">{message("claimantHistory.plainDetail")}</p>
      <h3>{message("claimantHistory.answer")}</h3>
      <p className="whitespace-pre-wrap break-words">{current.value.run.answer}</p>
      <h3>{message("claimantHistory.citations")}</h3>
      {current.value.run.citations.length ? <ul>{current.value.run.citations.map((citation, index) => <li key={index}>{citation.marker} · {citation.sourceName}</li>)}</ul> : <p>{message("claimantHistory.noCitations")}</p>}
    </>}
  </section>;
}
