"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { zoteroCollectionsSchema, zoteroStatusSchema, zoteroTokenSchema } from "@/lib/references/zotero-contract";
import copy from "@/locales/en/zotero.json";
const button = "min-h-11 border border-line px-4 py-2 text-sm disabled:opacity-50";
const field = "mt-2 block min-h-11 w-full border border-line bg-paper px-3 py-2";
export function ZoteroView() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy.checking}</p>;
  if (!session) return <Link href="/connect" className="underline">{copy.signIn}</Link>;
  return <ZoteroEditor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />;
}
export function ZoteroEditor({ wallet }: { wallet: string }) {
  const { ready, workspace, error } = useLiteratureWorkspace();
  const [connected, setConnected] = useState(false), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false);
  const [token, setToken] = useState(""), [reportId, setReportId] = useState(""), [selected, setSelected] = useState("");
  const [collections, setCollections] = useState<Array<{ key: string; name: string }>>([]), [message, setMessage] = useState("");
  const lifetime = useRef<AbortController | null>(null), active = useRef(false);
  const request = async (method: string, path = "", body?: unknown) => {
    const controller = lifetime.current; if (!controller || controller.signal.aborted) throw new Error("inactive");
    const response = await fetch(`/api/me/references/zotero${path}`, { method, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125_000)]), headers: { "X-Keryx-Expected-Wallet": wallet,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) {
      const messages: Record<string, string> = { zotero_unavailable: copy.unavailable, zotero_conflict: copy.conflict, zotero_scopes: copy.scopesFailed, zotero_backoff: copy.backoff, zotero_report_not_found: copy.notFound };
      throw new Error(messages[value.error] ?? copy.failed);
    }
    return value;
  };
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void request("GET").then(value => { const status = zoteroStatusSchema.parse(value); if (!controller.signal.aborted) { setAvailable(true); setConnected(status.connected); } })
      .catch(() => { if (!controller.signal.aborted) setMessage(copy.unavailable); });
    return () => controller.abort();
    // The entire editor remounts on account changes, clearing keys and selections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);
  const act = async (action: () => Promise<void>) => {
    if (active.current || lifetime.current?.signal.aborted) return;
    active.current = true; setBusy(true); setMessage("");
    try { await action(); } catch (issue) { if (!lifetime.current?.signal.aborted) setMessage(issue instanceof Error && Object.values(copy).includes(issue.message) ? issue.message : copy.failed); }
    finally { if (!lifetime.current?.signal.aborted) { active.current = false; setBusy(false); } }
  };
  const send = (kind: "papers" | "report") => {
    if (!window.confirm(copy.confirm)) return;
    void act(async () => {
      const value = await request("POST", "/send", kind === "papers" ? { kind, collection: selected, papers: workspace.entries.map(entry => entry.paper) } : { kind, collection: selected, reportId });
      if (!Number.isInteger(value.references) || value.references < 1 || value.collection !== selected || value.provider !== "zotero") throw new Error("invalid");
      if (!lifetime.current?.signal.aborted) setMessage(copy.sent);
    });
  };
  return <section className="space-y-5">
    <Link href="/me/bibliographies" prefetch={false} className="underline">{copy.bib}</Link>
    <p className="font-serif text-sm">{copy.scopes}</p>
    <a href="https://www.zotero.org/settings/keys" target="_blank" rel="noreferrer" className="underline">{copy.settings}</a>
    {!connected ? <form autoComplete="off" onSubmit={event => { event.preventDefault(); const key = token; setToken(""); void act(async () => {
      const value = zoteroStatusSchema.parse(await request("PUT", "", { apiKey: key }));
      if (!value.connected) throw new Error("invalid"); if (!lifetime.current?.signal.aborted) setConnected(true);
    }); }} className="space-y-3">
      <label className="block text-sm">{copy.keyLabel}<input type="password" autoComplete="off" maxLength={24} value={token} onChange={event => setToken(event.target.value)} disabled={busy || !available} className={field} /></label>
      <button className={button} disabled={busy || !available || !zoteroTokenSchema.safeParse(token).success}>{copy.connect}</button>
    </form> : <>
      <p>{copy.connected}</p>
      <button type="button" className={button} disabled={busy} onClick={() => void act(async () => {
        const value = await request("DELETE"); if (value.revoked !== true) throw new Error("invalid");
        if (!lifetime.current?.signal.aborted) { setConnected(false); setCollections([]); setSelected(""); setMessage(copy.disconnected); }
      })}>{copy.disconnect}</button>
      <button type="button" className={button} disabled={busy} onClick={() => void act(async () => {
        setSelected(""); setCollections([]); const value = await request("POST", "/collections"), rows = zoteroCollectionsSchema.parse(value.collections);
        if (!lifetime.current?.signal.aborted) setCollections(rows);
      })}>{copy.load}</button>
      <label className="block text-sm">{copy.collection}<select value={selected} onChange={event => setSelected(event.target.value)} disabled={busy || !collections.length} className={field}>
        <option value="">{copy.choose}</option>{collections.map(row => <option key={row.key} value={row.key}>{row.name}</option>)}
      </select></label>
      <p className="font-serif text-sm">{copy.savedScope}</p>
      <button type="button" className={button} disabled={busy || !selected || !ready || !!error || !workspace.entries.length} onClick={() => send("papers")}>{copy.saved} ({workspace.entries.length})</button>
      <p className="font-serif text-sm">{copy.reportScope}</p>
      <label className="block text-sm">{copy.reportLabel}<input maxLength={128} value={reportId} onChange={event => setReportId(event.target.value)} disabled={busy} className={field} /></label>
      <button type="button" className={button} disabled={busy || !selected || !/^[A-Za-z0-9_-]{1,128}$/.test(reportId)} onClick={() => send("report")}>{copy.report}</button>
    </>}
    {message && <p role="status" className="break-words font-serif text-sm">{message}</p>}
    <p className="font-serif text-xs text-ink-3">{copy.boundary}</p>
  </section>;
}
