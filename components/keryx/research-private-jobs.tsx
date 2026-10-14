"use client";
import { formatSigningUsdc } from "@/lib/i18n/format";
import { DisplayTime } from "@/components/keryx/display-time";
import { createRichMessages as createDateMessages } from "@/lib/i18n/rich-messages";

import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { privateWorkspaceHistorySchema, privateWorkspaceResultSchema,
  type PrivateWorkspaceHistory, type PrivateWorkspaceResult } from "@/lib/a2a/private-workspace";
import { ResearchPrivateResult } from "./research-private-result";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";

const message = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
export function ResearchPrivateJobs() {
  const { session } = useSiweAuth();
  return <section aria-labelledby="private-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="private-jobs-heading" className="font-display text-3xl">{message("privateResearchJobs.title")}</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">{message("privateResearchJobs.introduction")}</p>
    <p className="mt-2 font-serif text-sm text-ink-3">{message(browserPaymentProfile().testnet ? "privateResearchJobs.pilotNotice" : "privateResearchJobs.capacityNotice")}</p>
    <Link href="/me/private-jobs" prefetch={false} className="mt-3 inline-block text-sm underline">Completed private jobs and downloads</Link>
    {session === undefined ? <p role="status" className="mt-4">{message("privateResearchJobs.checkingSignIn")}</p> : session
      ? <PrivateJobs key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />
      : <Link href="/connect" className="mt-4 inline-block underline">{message("privateResearchJobs.signIn")}</Link>}
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
      } catch { if (active) setError(message("privateResearchJobs.historyUnavailable")); }
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
      } catch { if (active) setError(message("privateResearchJobs.resultUnavailable")); }
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
    <p className="break-all font-mono text-xs text-ink-3">{message("privateResearchJobs.account", { wallet })}</p>
    <button className={`${control} mt-3`} disabled={busy} onClick={() => refresh()}>{message("privateResearchJobs.refresh")}</button>
    {busy && <p role="status" className="mt-3">{message("privateResearchJobs.loading")}</p>}
    {error && <p role="alert" className="mt-3 text-seal">{error}</p>}
    {history?.jobs.length === 0 && !busy && <p className="mt-4 text-sm">{message("privateResearchJobs.empty")}</p>}
    <ul className="mt-4 divide-y divide-line">{history?.jobs.map(job => <li key={job.id} className="py-4">
      <p className="break-words font-serif">{job.question}</p>
      <p className="mt-1 text-sm text-ink-3">{dateCopy("privateResearchJobs.jobSummary", { mode: job.researchMode, date: <DisplayTime value={job.createdAt} />, amount: formatSigningUsdc(job.priceMicros) })}</p>
      <button className={`${control} mt-2`} onClick={() => open(job)}>{message("privateResearchJobs.viewJob")}</button>
    </li>)}</ul>
    {history?.nextCursor && <button className={control} disabled={busy} onClick={() => refresh(history.nextCursor)}>{message("privateResearchJobs.loadOlder")}</button>}
    {selection && <div className="mt-6 border-t border-line pt-5">
      <div className="flex flex-wrap gap-3"><button className={control} disabled={reading} onClick={() => open(selection.job)}>{message("privateResearchJobs.refreshJob")}</button>
        <button className={control} onClick={() => { setSelection(null); setResult(null); setReading(false); }}>{message("privateResearchJobs.close")}</button></div>
      {reading && <p role="status" className="mt-3">{message("privateResearchJobs.loadingResult")}</p>}
      {result && <ResearchPrivateResult job={result} />}
    </div>}
  </div>;
}

const dateCopy = createDateMessages("en");
