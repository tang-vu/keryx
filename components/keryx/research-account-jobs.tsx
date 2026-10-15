"use client";
import { DisplayTime } from "@/components/keryx/display-time";

import { createMessages } from "@/lib/i18n/messages";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { accountHistorySchema, type AccountHistory } from "@/lib/a2a/account-history-types";
import { ResearchJob } from "./research-job";
import { ResearchJobEscalation } from "./research-job-escalation";

const message = createMessages("en");

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";

export function ResearchAccountJobs() {
  const { session } = useSiweAuth();
  return <section aria-labelledby="account-jobs-heading" className="border border-line bg-paper p-6">
    <h2 id="account-jobs-heading" className="font-display text-3xl">{message("walletResearch.title")}</h2>
    <p className="mt-3 font-serif text-sm text-ink-2">{message("walletResearch.introduction")}</p>
    <p className="mt-2 font-serif text-sm text-ink-3">{message("walletResearch.privacyBoundary")}</p>
    {session === undefined ? <p className="mt-4" role="status">{message("walletResearch.checkingSignIn")}</p> : session
      ? <WalletHistory key={session.address.toLowerCase()} wallet={session.address.toLowerCase()} />
      : <Link href="/connect" className="mt-4 inline-block underline">{message("walletResearch.signIn")}</Link>}
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
          throw new Error(message("walletResearch.sessionEnded"));
        }
        if (!response.ok) throw new Error(message("walletResearch.loadFailed"));
        const parsed = accountHistorySchema.safeParse(await response.json());
        if (!parsed.success) throw new Error(message("walletResearch.verificationFailed"));
        const result = parsed.data;
        if (result.wallet !== wallet) throw new Error(message("walletResearch.walletMismatch"));
        if (!active) return;
        setHistory(previous => ({ jobs: request.cursor
          ? [...(previous?.jobs ?? []), ...result.jobs].filter((row, index, rows) => rows.findIndex(other => other.id === row.id) === index)
          : result.jobs, nextCursor: result.nextCursor }));
        setError("");
      } catch (cause) {
        if (active) setError(cause instanceof Error && !abort.signal.aborted ? cause.message : message("walletResearch.timeout"));
      } finally { clearTimeout(timer); if (active) setBusy(false); }
    })();
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [request, wallet]);
  function load(cursor = "") { setBusy(true); setError(""); if (!cursor) { setHistory(null); setSelected(null); } setRequest(previous => ({ cursor, revision: previous.revision + 1 })); }
  return <div className="mt-4">
    <p className="break-all font-mono text-xs text-ink-3">{message("walletResearch.payingWallet", { wallet })}</p>
    <button className={`${control} mt-3`} disabled={busy} onClick={() => load()}>{message("walletResearch.refresh")}</button>
    {busy && <p role="status" className="mt-3 text-sm">{message("walletResearch.loading")}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-seal">{error}</p>}
    {history?.jobs.length === 0 && !busy && <p className="mt-4 text-sm">{message("walletResearch.empty")}</p>}
    <ul className="mt-4 divide-y divide-line">
      {history?.jobs.map(row => <li key={row.id} className="py-4">
        <p className="break-words font-serif text-ink">{row.question ?? message("walletResearch.questionUnavailable")}</p>
        <p className="mt-1 text-sm text-ink-3">{row.mode} · {row.status.replaceAll("_", " ")} · {<DisplayTime value={row.createdAt} />}</p>
        <p className="mt-1 text-sm text-ink-2">{message(row.funding ? "walletResearch.monthlyPrice" : "walletResearch.packagePrice", { amount: row.packagePriceUsdc === null ? message("walletResearch.unknown") : `${row.packagePriceUsdc} USDC` })}</p>
        <ResearchJobEscalation escalation={row.escalation} status={row.status} original={row.originalPayment ? { orderId: row.id, payment: row.originalPayment } : undefined} />
        <button className={`${control} mt-2`} onClick={() => setSelected(row.id)}>{message("walletResearch.followJob")}</button>
      </li>)}
    </ul>
    {history?.nextCursor && <button className={control} disabled={busy} onClick={() => load(history.nextCursor!)}>{message("walletResearch.loadOlder")}</button>}
    {selected && <div className="mt-5"><p className="mb-3 text-sm text-ink-3">{message("walletResearch.serverRecordNotice")}</p><ResearchJob key={selected} initialId={selected} /><button className={`${control} mt-2`} onClick={() => setSelected(null)}>{message("walletResearch.close")}</button></div>}
  </div>;
}
