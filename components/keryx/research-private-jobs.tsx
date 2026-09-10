"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { privateWorkspaceHistorySchema, privateWorkspaceResultSchema, privateUsdc,
  type PrivateWorkspaceHistory, type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";
import { ResearchPrivateResult } from "./research-private-result";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
export function ResearchPrivateJobs() {
  const { session } = useSiweAuth();
  return <section aria-labelledby="private-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="private-jobs-heading" className="font-display text-3xl">Private research for your wallet</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">Find existing private jobs from your account, even on a new device. Opening a job never submits another payment.</p>
    <p className="mt-2 font-serif text-sm text-ink-3">Private purchasing is limited to configured pilot accounts. This view does not change access to past public research. Results are restricted to the paying account; this is not end-to-end encryption.</p>
    {session === undefined ? <p role="status" className="mt-4">Checking sign-in…</p> : session
      ? <PrivateJobs key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />
      : <Link href="/connect" className="mt-4 inline-block underline">Sign in to view private jobs</Link>}
  </section>;
}

function PrivateJobs({ wallet }: { wallet: string }) {
  const [request, setRequest] = useState<{ cursor: PrivateWorkspaceHistory["nextCursor"]; revision: number }>({ cursor: null, revision: 0 });
  const [history, setHistory] = useState<PrivateWorkspaceHistory | null>(null);
  const [selection, setSelection] = useState<{ job: PrivateWorkspaceHistory["jobs"][number]; revision: number } | null>(null);
  const [result, setResult] = useState<PrivateWorkspaceResult | null>(null);
  const [busy, setBusy] = useState(true), [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/me/private-jobs/history", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor: request.cursor }), signal: abort.signal });
        if (response.status === 401) {
          if (active) { setHistory(null); setSelection(null); setResult(null); window.dispatchEvent(new Event("keryx:auth")); }
          throw new Error("Sign in again to view private jobs.");
        }
        if (!response.ok) throw new Error("Private history could not be loaded. Refresh to retry.");
        const parsed = privateWorkspaceHistorySchema.parse(await readBoundedJson(response));
        if (parsed.wallet !== wallet) throw new Error("Private history did not match your wallet.");
        if (!active) return;
        setHistory(previous => ({ ...parsed, jobs: request.cursor
          ? [...(previous?.jobs ?? []), ...parsed.jobs].filter((job, index, jobs) => jobs.findIndex(other => other.id === job.id) === index)
          : parsed.jobs }));
      } catch { if (active) setError("Private history is unavailable. Check sign-in and refresh to retry."); }
      finally { clearTimeout(timer); if (active) setBusy(false); }
    })();
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [request, wallet]);
  useEffect(() => {
    if (!selection) return;
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 20000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/me/private-jobs/result", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selection.job.id }), signal: abort.signal });
        if (response.status === 401) {
          if (active) { setHistory(null); setSelection(null); setResult(null); window.dispatchEvent(new Event("keryx:auth")); }
          throw new Error("Sign in again.");
        }
        if (!response.ok) throw new Error("Private result unavailable");
        const parsed = privateWorkspaceResultSchema.parse(await readBoundedJson(response, 16_777_216));
        if (parsed.wallet !== wallet || parsed.request.question !== selection.job.question
          || parsed.request.researchMode !== selection.job.researchMode || parsed.request.model !== selection.job.model
          || parsed.request.packageVersion !== selection.job.packageVersion || parsed.spend.incoming.priceMicros !== selection.job.priceMicros) throw new Error("Private result mismatch");
        if (active) setResult(parsed);
      } catch { if (active) setError("Private result is unavailable. Check sign-in and refresh this job to retry."); }
      finally { clearTimeout(timer); if (active) setReading(false); }
    })();
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [selection, wallet]);
  function refresh(cursor: PrivateWorkspaceHistory["nextCursor"] = null) {
    setBusy(true); setError("");
    if (!cursor) { setHistory(null); setSelection(null); setResult(null); setReading(false); }
    setRequest(previous => ({ cursor, revision: previous.revision + 1 }));
  }
  function open(job: PrivateWorkspaceHistory["jobs"][number]) {
    setError(""); setResult(null); setReading(true);
    setSelection(previous => ({ job, revision: (previous?.revision ?? 0) + 1 }));
  }
  return <div className="mt-4">
    <p className="break-all font-mono text-xs text-ink-3">Account: {wallet}</p>
    <button className={`${control} mt-3`} disabled={busy} onClick={() => refresh()}>Refresh private jobs</button>
    {busy && <p role="status" className="mt-3">Loading private jobs…</p>}
    {error && <p role="alert" className="mt-3 text-seal">{error}</p>}
    {history?.jobs.length === 0 && !busy && <p className="mt-4 text-sm">No private jobs found for this wallet. Jobs paid by a separate agent wallet belong to that account.</p>}
    <ul className="mt-4 divide-y divide-line">{history?.jobs.map(job => <li key={job.id} className="py-4">
      <p className="break-words font-serif">{job.question}</p>
      <p className="mt-1 text-sm text-ink-3">{job.researchMode} · {new Date(job.createdAt).toLocaleString("en-US")} · Package price {privateUsdc(job.priceMicros)}</p>
      <button className={`${control} mt-2`} onClick={() => open(job)}>View private job</button>
    </li>)}</ul>
    {history?.nextCursor && <button className={control} disabled={busy} onClick={() => refresh(history.nextCursor)}>Load older private jobs</button>}
    {selection && <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap gap-3"><button className={control} disabled={reading} onClick={() => open(selection.job)}>Refresh this job</button>
        <button className={control} onClick={() => { setSelection(null); setResult(null); setReading(false); }}>Close private job</button></div>
      {reading && <p role="status" className="mt-3">Loading private result…</p>}
      {result && <ResearchPrivateResult job={result} />}
    </div>}
  </div>;
}
