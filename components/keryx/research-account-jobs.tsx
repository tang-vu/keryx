"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { accountHistorySchema, type AccountHistory } from "@/lib/a2a/account-history-types";
import { ResearchJob } from "./research-job";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";

export function ResearchAccountJobs() {
  const { session } = useSiweAuth();
  return <section aria-labelledby="account-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="account-jobs-heading" className="font-display text-3xl">Paid jobs for your wallet</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">Find browser and agent purchases paid by your signed-in wallet, including jobs missing from this browser&apos;s saved files. Sponsored playground dispatches are separate.</p>
    <p className="mt-2 font-serif text-sm text-ink-3">This account list requires sign-in. Existing job results still use link-based access and may appear in the public archive; signing in does not make past research private.</p>
    {session === undefined ? <p className="mt-4" role="status">Checking sign-in…</p> : session
      ? <WalletHistory key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />
      : <Link href="/connect" className="mt-4 inline-block underline">Sign in with the wallet that paid</Link>}
  </section>;
}

function WalletHistory({ wallet }: { wallet: string }) {
  const [request, setRequest] = useState({ cursor: "", revision: 0 });
  const [history, setHistory] = useState<{ jobs: AccountHistory["jobs"]; nextCursor: string | null } | null>(null);
  const [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20000);
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/me/jobs${request.cursor ? `?cursor=${encodeURIComponent(request.cursor)}` : ""}`, { cache: "no-store", signal: abort.signal });
        if (response.status === 401) {
          if (active) { setHistory(null); setSelected(null); window.dispatchEvent(new Event("keryx:auth")); }
          throw new Error("Sign in again to view paid jobs.");
        }
        if (!response.ok) throw new Error("Paid job history could not be loaded. Refresh to retry.");
        const parsed = accountHistorySchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("Paid job history could not be verified. Refresh to retry.");
        const result = parsed.data;
        if (result.wallet !== wallet) throw new Error("The history response did not match your wallet.");
        if (!active) return;
        setHistory(previous => ({ jobs: request.cursor
          ? [...(previous?.jobs ?? []), ...result.jobs].filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index)
          : result.jobs, nextCursor: result.nextCursor }));
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error && !abort.signal.aborted ? cause.message : "History lookup timed out. Refresh to retry.");
      } finally { clearTimeout(timer); if (active) setBusy(false); }
    })();
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [request, wallet]);
  function load(cursor = "") { setBusy(true); setError(""); if (!cursor) { setHistory(null); setSelected(null); } setRequest(previous => ({ cursor, revision: previous.revision + 1 })); }
  return <div className="mt-4">
    <p className="break-all font-mono text-xs text-ink-3">Paying wallet: {wallet}</p>
    <button className={`${control} mt-3`} disabled={busy} onClick={() => load()}>Refresh paid jobs</button>
    {busy && <p role="status" className="mt-3 text-sm">Loading paid jobs…</p>}
    {error && <p role="alert" className="mt-3 text-sm text-seal">{error}</p>}
    {history?.jobs.length === 0 && !busy && <p className="mt-4 text-sm">No paid jobs found for this wallet. Purchases made by a separate agent wallet belong to that wallet.</p>}
    <ul className="mt-4 divide-y divide-line">
      {history?.jobs.map(row => <li key={row.id} className="py-4">
        <p className="break-words font-serif text-ink">{row.question ?? "Question unavailable for this historical job"}</p>
        <p className="mt-1 text-sm text-ink-3">{row.mode} · {row.status.replaceAll("_", " ")} · {new Date(row.createdAt).toLocaleString("en-US")}</p>
        <p className="mt-1 text-sm text-ink-2">Package price: {row.packagePriceUsdc === null ? "unknown" : `${row.packagePriceUsdc} USDC`} · Arc testnet</p>
        <button className={`${control} mt-2`} onClick={() => setSelected(row.id)}>Follow this job</button>
      </li>)}
    </ul>
    {history?.nextCursor && <button className={control} disabled={busy} onClick={() => load(history.nextCursor!)}>Load older jobs</button>}
    {selected && <div className="mt-5"><p className="mb-3 text-sm text-ink-3">This lookup uses the server record. Import your original recovery file to verify the receipt against the request saved before payment.</p><ResearchJob key={selected} initialId={selected} /><button className={`${control} mt-2`} onClick={() => setSelected(null)}>Close job</button></div>}
  </div>;
}
