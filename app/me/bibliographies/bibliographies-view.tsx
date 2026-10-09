"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { useLiteratureWorkspace } from "@/lib/papers/literature-browser-store";
import { bibliographyInputSchema, bibliographyMetadataSchema, MAX_PRIVATE_BIBLIOGRAPHIES, type BibliographyMetadata } from "@/lib/bibliographies/private-bibliography";
import copy from "@/locales/en/bibliographies.json";

const button = "min-h-11 border border-line px-4 py-2 text-sm disabled:opacity-50";
export function BibliographiesView() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy.checking}</p>;
  if (!session) return <Link className="underline" href="/connect">{copy.signIn}</Link>;
  return <BibliographiesEditor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />;
}
/** No mount-time publication, automatic retry, local secret persistence or links that can prefetch the bearer URL. */
export function BibliographiesEditor({ wallet }: { wallet: string }) {
  const { ready, workspace, error } = useLiteratureWorkspace();
  const [rows, setRows] = useState<BibliographyMetadata[] | null>(null), [title, setTitle] = useState("");
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ id: string; url: string } | null>(null);
  const lifetime = useRef<AbortController | null>(null), active = useRef(false);
  const listGeneration = useRef(0);
  const request = async (method: string, id?: string, body?: unknown, revision?: number) => {
    const controller = lifetime.current;
    if (!controller || controller.signal.aborted) throw new Error(copy.failed);
    const response = await fetch(`/api/me/bibliographies${id ? `/${id}` : ""}`, { method, cache: "no-store", redirect: "error",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
      headers: { "X-Keryx-Expected-Wallet": wallet, ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json();
    if (!response.ok) throw new Error(response.status === 503 ? copy.unavailable : response.status === 409 || response.status === 404 ? copy.conflict : response.status === 422 ? copy.limit : response.status === 400 ? copy.invalid : copy.failed);
    return value;
  };
  const reload = async () => {
    const generation = ++listGeneration.current;
    const value = await request("GET"), parsed = bibliographyMetadataSchema.array().max(MAX_PRIVATE_BIBLIOGRAPHIES).parse(value.bibliographies);
    if (!lifetime.current?.signal.aborted && generation === listGeneration.current) setRows(parsed);
  };
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void reload().catch(() => { if (!controller.signal.aborted) setMessage(copy.unavailable); });
    return () => controller.abort();
    // This editor remounts whenever the authenticated owner changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);
  const act = async (action: () => Promise<void>) => {
    if (active.current || lifetime.current?.signal.aborted) return;
    active.current = true; setBusy(true); setMessage("");
    try { await action(); } catch (issue) { if (!lifetime.current?.signal.aborted) setMessage(issue instanceof Error ? issue.message : copy.failed); }
    finally { if (!lifetime.current?.signal.aborted) { active.current = false; setBusy(false); } }
  };
  const publish = async (row?: BibliographyMetadata) => {
    listGeneration.current++;
    const parsed = bibliographyInputSchema.safeParse({ title: row?.title ?? title, papers: workspace.entries.map(entry => entry.paper) });
    if (!parsed.success) throw new Error(copy.invalid);
    const value = await request(row ? "PUT" : "POST", row?.id, parsed.data, row?.revision);
    const saved = bibliographyMetadataSchema.parse(value.bibliography);
    if (row && saved.id !== row.id) throw new Error(copy.failed);
    if (!row && (typeof value.urlPath !== "string" || !/^\/api\/bibliographies\/[0-9a-f]{64}\.bib$/.test(value.urlPath))) throw new Error(copy.failed);
    if (lifetime.current?.signal.aborted) return;
    setRows(current => row ? current?.map(item => item.id === saved.id ? saved : item) ?? [saved] : [...(current ?? []), saved]);
    if (!row) { setSecret({ id: saved.id, url: window.location.origin + value.urlPath }); setTitle(""); }
    setMessage(row ? copy.updated : copy.created);
  };
  return <section className="space-y-5">
    <p className="font-serif text-sm text-ink-3">{copy.source}</p>
    <Link className="underline" href="/literature">{copy.workspace}</Link>
    <p className="font-mono text-xs">{workspace.entries.length} {copy.ready}</p>
    <form onSubmit={event => { event.preventDefault(); void act(() => publish()); }} className="space-y-3">
      <label className="block font-serif text-sm">{copy.titleLabel}<input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} disabled={busy}
        className="mt-2 block min-h-11 w-full border border-line bg-paper px-3 py-2" /></label>
      <button className={button} disabled={busy || !rows || !ready || !!error || workspace.entries.length === 0 || rows.length >= MAX_PRIVATE_BIBLIOGRAPHIES}>{copy.create}</button>
    </form>
    <button type="button" className={button} disabled={busy} onClick={() => void act(reload)}>{copy.reload}</button>
    {message && <p role="status" className="break-words font-serif text-sm">{message}</p>}
    {secret && <div className="space-y-3 border border-line p-4">
      <label className="block font-serif text-sm">{copy.secretLabel}<input readOnly value={secret.url} className="mt-2 block min-h-11 w-full border border-line bg-paper px-3 py-2 font-mono text-xs" onFocus={event => event.target.select()} /></label>
      <button type="button" className={button} onClick={() => { void Promise.resolve().then(() => navigator.clipboard.writeText(secret.url)).then(() => setMessage(copy.copied), () => setMessage(copy.clipboardFailed)); }}>{copy.copy}</button>
    </div>}
    {!rows ? <p>{copy.loading}</p> : rows.length === 0 ? <p>{copy.empty}</p> : <ul className="space-y-4">{rows.map(row => <li key={row.id} className="space-y-3 border border-line p-4">
      <h2 className="break-words font-serif text-lg">{row.title}</h2><p className="font-mono text-xs">{row.count} {copy.papers} · {copy.revision} {row.revision}</p>
      <div className="flex flex-wrap gap-3"><button type="button" className={button} disabled={busy || !ready || !!error} onClick={() => { if (window.confirm(copy.replaceConfirm.replace("{count}", String(workspace.entries.length)))) void act(() => publish(row)); }}>{copy.replace}</button>
        <button type="button" className={button} disabled={busy} onClick={() => { if (window.confirm(copy.revokeConfirm)) void act(async () => {
          listGeneration.current++;
          const value = await request("DELETE", row.id, undefined, row.revision); if (value.revoked !== true) throw new Error(copy.failed);
          if (!lifetime.current?.signal.aborted) { setRows(current => current?.filter(item => item.id !== row.id) ?? []); setSecret(current => current?.id === row.id ? null : current); setMessage(copy.revoked); }
        }); }}>{copy.revoke}</button></div>
    </li>)}</ul>}
    <p className="font-serif text-xs text-ink-3">{copy.boundary}</p>
  </section>;
}
