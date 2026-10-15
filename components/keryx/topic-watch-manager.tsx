"use client";

import Link from "next/link";
import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import type { TopicWatchResult, TopicWatchSpec, TopicWatchState } from "@/lib/research/topic-watches";

const copy = createMessages("en");
const button = "min-h-11 border border-line px-4 py-2 text-sm disabled:opacity-50";
const field = "block w-full border border-line bg-paper p-2";
const terms = (value: FormDataEntryValue | null) => String(value ?? "").split(",").map(s => s.trim()).filter(Boolean);
export function TopicWatchManager() {
  const { session } = useSiweAuth();
  if (session === undefined) return <p role="status">{copy("topicWatch.checking")}</p>;
  if (!session) return <Link href="/connect" className="underline">{copy("topicWatch.signIn")}</Link>;
  return <WatchEditor key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />;
}
function WatchEditor({ wallet }: { wallet: string }) {
  const [watches, setWatches] = useState<TopicWatchState[]>([]), [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const [result, setResult] = useState<TopicWatchResult | null>(null), [editing, setEditing] = useState<TopicWatchState | null>(null);
  const epoch = useRef(0), mutation = useRef(false);
  async function request(path: string, method = "GET", body?: unknown, revision?: number) {
    const response = await fetch(`/api/me/topic-watches${path}`, { method, cache: "no-store", credentials: "same-origin",
      signal: AbortSignal.timeout(15000), headers: { "x-keryx-expected-wallet": wallet,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(revision === undefined ? {} : { "If-Match": `"${revision}"` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? data.result?.code ?? data.result?.status ?? copy("topicWatch.requestUnavailable"));
    return data;
  }
  async function refresh() {
    const attempt = epoch.current;
    try {
      const data = await request("");
      if (attempt === epoch.current) { setWatches(data.watches); setLoaded(true); setError(""); }
    } catch (failure) {
      if (attempt === epoch.current) { setWatches([]); setLoaded(false); setError(failure instanceof Error ? failure.message : copy("topicWatch.listUnavailable")); }
    }
  }
  useEffect(() => {
    void refresh();
    const changed = () => { epoch.current++; setGeneration(value => value + 1); setWatches([]); setLoaded(false); setEditing(null); setResult(null); setError(copy("topicWatch.accountChanged")); };
    window.addEventListener("keryx:auth", changed);
    window.addEventListener("focus", changed);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("keryx-auth-v1"); channel.onmessage = changed; } catch { /* Focus invalidation remains available. */ }
    return () => { epoch.current++; window.removeEventListener("keryx:auth", changed); window.removeEventListener("focus", changed); channel?.close(); };
    // Wallet-keyed instance deliberately owns one account generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet]);
  async function mutate(operation: () => Promise<{ result: TopicWatchResult }>) {
    if (mutation.current) return;
    mutation.current = true; setBusy(true); setError(""); setResult(null);
    const attempt = epoch.current;
    try {
      const data = await operation();
      if (attempt !== epoch.current) return;
      setResult(data.result); setEditing(null); await refresh();
    } catch (failure) {
      if (attempt === epoch.current) setError(copy("topicWatch.retry", { message: failure instanceof Error ? failure.message : copy("topicWatch.unavailable") }));
    } finally { mutation.current = false; setBusy(false); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget), id = editing?.key.watchId ?? crypto.randomUUID();
    const spec: TopicWatchSpec = { watchId: id, question: String(form.get("question")), keywords: terms(form.get("keywords")),
      authors: terms(form.get("authors")), venues: terms(form.get("venues")), cadenceMs: Number(form.get("cadence")) * 60_000,
      periodMs: Number(form.get("period")) * 86_400_000, maximumChecksPerPeriod: Number(form.get("checks")),
      maximumRowsPerCheck: 32, maximumDigestItems: 16,
      expiresAtMs: editing?.spec.expiresAtMs ?? Date.now() + Number(form.get("expiry")) * 86_400_000,
      requestedCaps: { perCheckMicroUsdc: 0, perPeriodMicroUsdc: 0 },
      consent: { manualMetadata: true, emptyHeartbeat: form.get("heartbeat") === "on" } };
    void mutate(() => request(editing ? `/${id}` : "", editing ? "PUT" : "POST", spec, editing?.revision));
  }
  function control(watch: TopicWatchState, action: "check" | "pause" | "resume" | "cancel") {
    void mutate(() => request(`/${watch.key.watchId}`, action === "cancel" ? "DELETE" : "POST",
      action === "cancel" ? undefined : { action }, watch.revision));
  }
  return <section className="space-y-5" aria-label={copy("topicWatch.title")}>
    <p>{copy("topicWatch.scope")}</p>
    <button className={button} disabled={busy} onClick={() => { void refresh(); }}>{copy("topicWatch.refresh")}</button>
    {error && <p role="alert">{error}</p>}
    {result && <div role="status"><p>{copy("topicWatch.result", { status: result.status, code: result.code ? `: ${result.code}` : "", paidRequests: result.paidRequests })}</p>
      {result.digest && <><p>{result.digest.line}</p><ul>{result.digest.items.map(item => <li key={`${item.identitySha256}:${item.metadataSha256}`}>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{item.title}</a>
        <span> — {item.matchReasons.map(reason => `${reason.field}: ${reason.term}`).join("; ")}</span>
      </li>)}</ul></>}
      {result.missed && <p>{copy("topicWatch.missed", { count: result.missed.count })}</p>}
    </div>}
    <form key={`${generation}:${editing ? `${editing.key.watchId}:${editing.revision}` : "new"}`} onSubmit={save} className="space-y-3 border border-line p-4">
      <h2>{editing ? copy("topicWatch.editTitle") : copy("topicWatch.createTitle")}</h2>
      <label className="block">{copy("topicWatch.question")}<input className={field} name="question" required maxLength={2000} defaultValue={editing?.spec.question} /></label>
      <label className="block">{copy("topicWatch.keywords")}<input className={field} name="keywords" required defaultValue={editing?.spec.keywords.join(", ")} /></label>
      <label className="block">{copy("topicWatch.authors")}<input className={field} name="authors" defaultValue={editing?.spec.authors.join(", ")} /></label>
      <label className="block">{copy("topicWatch.venues")}<input className={field} name="venues" defaultValue={editing?.spec.venues.join(", ")} /></label>
      <label className="block">{copy("topicWatch.cadence")}<input className={field} name="cadence" type="number" min={1} max={10080} required defaultValue={editing ? editing.spec.cadenceMs / 60_000 : 1440} /></label>
      <label className="block">{copy("topicWatch.period")}<input className={field} name="period" type="number" min={1} max={30} required defaultValue={editing ? editing.spec.periodMs / 86_400_000 : 7} /></label>
      <label className="block">{copy("topicWatch.checks")}<input className={field} name="checks" type="number" min={1} max={128} required defaultValue={editing?.spec.maximumChecksPerPeriod ?? 7} /></label>
      {!editing && <label className="block">{copy("topicWatch.expiry")}<input className={field} name="expiry" type="number" min={1} max={30} defaultValue={7} required /></label>}
      <label className="block"><input type="checkbox" name="heartbeat" defaultChecked={editing?.spec.consent.emptyHeartbeat} /> {copy("topicWatch.heartbeat")}</label>
      <label className="block"><input type="checkbox" name="consent" required /> {copy("topicWatch.consent")}</label>
      <button className={button} disabled={busy || !loaded}>{editing ? copy("topicWatch.save") : copy("topicWatch.create")}</button>
      {editing && <button className={button} type="button" onClick={() => setEditing(null)}>{copy("topicWatch.close")}</button>}
    </form>
    {loaded && watches.length === 0 && <p>{copy("topicWatch.empty")}</p>}
    <ul className="space-y-5">{watches.map(watch => <li className="border border-line p-4" key={watch.key.watchId}>
      <h2>{watch.spec.question}</h2><p>{copy("topicWatch.state", { status: watch.status, revision: watch.revision, expires: new Date(watch.spec.expiresAtMs).toISOString() })}</p>
      <p>{copy("topicWatch.keywordValues", { keywords: watch.spec.keywords.join(", ") })}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || watch.status !== "active" || Date.now() >= watch.spec.expiresAtMs} onClick={() => control(watch, "check")}>{copy("topicWatch.check")}</button>
        <button className={button} disabled={busy || watch.status === "cancelled"} onClick={() => control(watch, watch.status === "paused" ? "resume" : "pause")}>{watch.status === "paused" ? copy("topicWatch.resume") : copy("topicWatch.pause")}</button>
        <button className={button} disabled={busy || watch.status === "cancelled"} onClick={() => control(watch, "cancel")}>{copy("topicWatch.cancel")}</button>
        <button className={button} disabled={busy || watch.status === "cancelled" || watch.nextSlot !== 0} onClick={() => setEditing(watch)}>{copy("topicWatch.edit")}</button>
      </div>
      <details><summary>{copy("topicWatch.history", { count: watch.history.length })}</summary><ul>{watch.history.map((entry, index) => <li key={index}>{entry.kind === "missed"
        ? copy("topicWatch.missedHistory", { fromSlot: entry.fromSlot, toSlot: entry.toSlot })
        : copy("topicWatch.slotHistory", { slot: entry.slot, status: entry.status, reason: entry.reason ? ` (${entry.reason})` : "", matches: entry.newMatches !== undefined ? copy("topicWatch.newMatches", { count: entry.newMatches }) : "" })}</li>)}</ul></details>
      {watch.status === "cancelled" && <p>{copy("topicWatch.cancelled")}</p>}
    </li>)}</ul>
  </section>;
}
