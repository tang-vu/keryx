"use client";

import { useEffect, useState } from "react";
import { a2aQueryIdSchema, buyerJobSchema, shouldPollBuyerJob, type BuyerJob } from "@/lib/a2a/buyer-workspace";

const control = "border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40";
const usdc = (value: number | null | undefined) => value == null ? "Unknown" : `${value.toFixed(6)} USDC`;

export function ResearchJob() {
  const [input, setInput] = useState("");
  const [lookup, setLookup] = useState<{ id: string; revision: number } | null>(null);
  const [job, setJob] = useState<BuyerJob | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [updated, setUpdated] = useState("");

  useEffect(() => {
    if (!lookup) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let calls = 0;
    async function poll() {
      if (!lookup) return;
      const timeout = setTimeout(() => abort.abort(), 20_000);
      try {
        const response = await fetch(`/api/agent/ask?queryId=${encodeURIComponent(lookup.id)}`, { signal: abort.signal, cache: "no-store", redirect: "error", credentials: "omit" });
        if (!response.ok) throw new Error(`Job lookup failed (${response.status}). Keep your job ID and refresh; this does not buy another job.`);
        const parsed = buyerJobSchema.safeParse(await response.json());
        if (!parsed.success || parsed.data.queryId !== lookup.id) throw new Error("The job response could not be verified. Keep your job ID and refresh later.");
        if (abort.signal.aborted) return;
        setJob(parsed.data); setUpdated(new Date().toLocaleTimeString()); setLoading(false);
        calls++;
        if (shouldPollBuyerJob(parsed.data.status)) {
          if (calls < 150) timer = setTimeout(poll, 4_000);
          else setError("Automatic refresh paused after ten minutes. Refresh to keep following this job.");
        }
      } catch (cause) {
        if (!abort.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Could not load this job.");
          setLoading(false);
        }
      } finally { clearTimeout(timeout); }
    }
    // Timeout and unmount both abort fetch; only a live effect may update the UI.
    const onAbort = () => { setLoading(false); setError("Lookup stopped. Refresh to try again; no new payment is needed."); };
    abort.signal.addEventListener("abort", onAbort);
    void poll();
    return () => { abort.signal.removeEventListener("abort", onAbort); abort.abort(); clearTimeout(timer); };
  }, [lookup]);

  function openJob() {
    const parsed = a2aQueryIdSchema.safeParse(input.trim());
    if (!parsed.success) { setError("Enter the complete a2a_ job ID returned by your paid request."); return; }
    setError(""); setJob(null); setUpdated(""); setLoading(true);
    setLookup((previous) => ({ id: parsed.data, revision: (previous?.revision ?? 0) + 1 }));
  }

  return <section aria-labelledby="job-heading" className="border border-line bg-paper p-6">
    <h2 id="job-heading" className="font-display text-3xl">2. Follow a paid job</h2>
    <p className="mt-3 font-serif text-ink-3">Your job ID grants access to its result. Keep it private. This page does not save it to browser storage or the address bar.</p>
    <form onSubmit={(event) => { event.preventDefault(); openJob(); }} className="mt-5 flex flex-wrap gap-3">
      <label htmlFor="research-job-id" className="sr-only">Paid job ID</label>
      <input id="research-job-id" value={input} onChange={(event) => setInput(event.target.value)} placeholder="a2a_…" autoComplete="off" spellCheck={false} className="min-w-0 flex-1 basis-full border border-line bg-paper-2 p-3 font-mono text-xs sm:basis-auto" />
      <button className={control}>Open / refresh</button>
      {lookup && <button type="button" className={control} onClick={() => { setLookup(null); setInput(""); setJob(null); setError(""); setUpdated(""); setLoading(false); }}>Clear job</button>}
    </form>
    <div role="status" aria-live="polite" className="mt-4 font-mono text-xs">{loading ? "Looking up job…" : job ? `${job.status.replaceAll("_", " ")} · updated ${updated}` : ""}</div>
    {error && <p role="alert" className="mt-3 font-serif text-seal">{error}</p>}
    {job && <div className="mt-5 space-y-6">
      {(job.message || job.error) && <p className="border-l-2 border-seal pl-4 font-serif">{job.message ?? job.error}</p>}
      {job.status === "review_required" && <p className="font-serif">Operator review is required. Automatic polling has stopped. Refresh this job after review; do not submit a new payment to recover it.</p>}
      {(job.serviceStatus || job.serviceReceipt) && <p className="font-mono text-xs">{Math.round((job.serviceStatus?.elapsedMs ?? job.serviceReceipt!.totalDurationMs) / 1000)}s elapsed · {Math.round((job.serviceStatus?.targetCompletionMs ?? job.serviceReceipt!.targetCompletionMs) / 1000)}s provisional target · {job.serviceStatus ? (job.serviceStatus.targetBreached ? "target exceeded" : "in progress") : job.serviceReceipt!.targetMet ? "target met" : "target not met"}. No SLA remedy.</p>}
      {job.pricing ? <>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ["Package paid", job.pricing.totalPriceUsdc], ["Service fee", job.pricing.serviceFeeUsdc],
            ["Creator cap", job.pricing.creatorBudgetUsdc], ["Settled to creators", job.pricing.settledCreatorSpendUsdc],
            ["Pending creator spend", job.pricing.pendingCreatorSpendUsdc], ["Unused reserve (not a refund)", job.pricing.unusedCreatorReserveUsdc],
          ] as const).map(([label, value]) => <div key={label} className="border border-line p-4"><dt className="font-mono text-xs text-ink-3">{label}</dt><dd className="mt-2 font-serif text-lg">{usdc(value)}</dd></div>)}
        </dl>
        {job.pricing.accountingComplete === false && <p className="text-seal">Incomplete accounting: recorded creator payments are a lower bound. Unused reserve is unknown.</p>}
      </> : <p className="font-serif text-ink-3">Creator settlement totals are not available in this response yet.</p>}
      {job.serviceReceipt?.quality && <p className="font-serif">Grounded claims: {job.serviceReceipt.quality.status === "measured" && job.serviceReceipt.quality.groundedClaimRate !== null ? `${(job.serviceReceipt.quality.groundedClaimRate * 100).toFixed(1)}%` : "measurement unavailable"}.</p>}
      {job.answer && <div><h3 className="font-display text-2xl">Research answer</h3><p className="mt-3 whitespace-pre-wrap font-serif leading-relaxed">{job.answer}</p></div>}
      {!!job.claimCoverage?.length && <div><h3 className="font-display text-2xl">Claim evidence</h3><ol className="mt-4 space-y-4">{job.claimCoverage.map((claim, index) => <li key={index} className="border border-line p-4">
        <p className="font-serif">{claim.claim}</p><p className="mt-2 font-mono text-xs">{(claim.coverage * 100).toFixed(1)}% evidence coverage</p>
        {job.evidence?.filter((item) => item.claimIndex === claim.claimIndex).map((item, i) => <blockquote key={i} className="mt-3 border-l border-line pl-3 font-serif text-sm"><p>“{item.quote}”</p><cite>{item.sourceName}</cite></blockquote>)}
      </li>)}</ol></div>}
      {job.status === "completed" && <a href={`/api/dispatch/${job.queryId}/receipt`} referrerPolicy="no-referrer" className="inline-block border border-ink px-4 py-3 font-mono text-xs">Open portable receipt JSON →</a>}
      <p className="font-serif text-xs text-ink-3">Arc testnet USDC. Evidence coverage measures grounding; it does not certify factual correctness. This view displays server-reported settlement; downloading a receipt does not independently verify it.</p>
    </div>}
  </section>;
}
