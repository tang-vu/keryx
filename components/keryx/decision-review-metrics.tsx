"use client";
import { useEffect, useRef, useState } from "react";
import { readBoundedJson } from "@/lib/read-bounded-json";
import { decisionReviewMetricsSchema, reviewPeriodSchema, type DecisionReviewMetrics } from "@/lib/research/decision-review-types";
import { decisionReviewCopy as copy } from "@/lib/research/decision-review-copy";

export function DecisionReviewMetricsView() {
  const [since, setSince] = useState(""), [until, setUntil] = useState("");
  const [result, setResult] = useState<DecisionReviewMetrics | null>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null), active = useRef(true);
  useEffect(() => { active.current = true; const timer = setTimeout(() => {
    const end = new Date(); end.setUTCHours(0, 0, 0, 0); const start = new Date(end.getTime() - 30 * 86_400_000);
    setSince(start.toISOString().slice(0, 10)); setUntil(end.toISOString().slice(0, 10));
  }, 0); return () => { clearTimeout(timer); active.current = false; request.current?.abort(); }; }, []);
  async function load() {
    if (request.current) return;
    const period = { network: "eip155:5042002", since: `${since}T00:00:00.000Z`, until: `${until}T00:00:00.000Z` };
    // The endpoint selects its configured network; this dummy value validates dates only.
    if (!reviewPeriodSchema.safeParse(period).success || Date.parse(period.until) > Date.now()) { setNotice(copy.invalidPeriod); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice(copy.loading); setResult(null);
    try {
      const response = await fetch(`/api/decision-reviews/metrics?${new URLSearchParams({ since: period.since, until: period.until })}`, {
        credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error(); const value = decisionReviewMetricsSchema.parse(await readBoundedJson(response, 50_000));
      if (value.since !== period.since || value.until !== period.until) throw new Error();
      if (active.current && !controller.signal.aborted) { setResult(value); setNotice(""); }
    } catch { if (active.current && !controller.signal.aborted) setNotice(copy.metricsUnavailable); }
    finally { if (request.current === controller) request.current = null; if (active.current) setBusy(false); }
  }
  return <div className="min-w-0">
    <form className="mt-6 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void load(); }}>
      <label className="block text-xs text-ink-2">{copy.since}<input type="date" required value={since} onChange={event => setSince(event.target.value)} className="mt-1 block min-h-11 border border-line bg-paper px-3" /></label>
      <label className="block text-xs text-ink-2">{copy.until}<input type="date" required value={until} onChange={event => setUntil(event.target.value)} className="mt-1 block min-h-11 border border-line bg-paper px-3" /></label>
      <button type="submit" disabled={busy} className="min-h-11 border border-line px-4 py-2 font-mono text-xs disabled:opacity-50">{copy.loadMetrics}</button>
    </form>
    {notice && <p role="status" className="mt-4 text-sm text-ink-2">{notice}</p>}
    {result && <>
      <p className="mt-5 break-words text-xs text-ink-3">{result.network} · {result.rule}</p>
      <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm">
        <caption className="mb-3 text-left text-xs text-ink-3">{copy.metricsCaption}</caption>
        <thead><tr>{[copy.cohort, copy.decisions, copy.agree, copy.disagree, copy.rate, copy.differences, copy.refusals].map(label => <th key={label} scope="col" className="border-b border-line p-2 font-mono text-xs">{label}</th>)}</tr></thead>
        <tbody>{result.cohorts.map(row => <tr key={row.cohort}><th scope="row" className="border-b border-line p-2 font-normal">{copy.cohorts[row.cohort]}</th>
          <td className="p-2">{row.decisions}</td><td className="p-2">{row.agrees}</td><td className="p-2">{row.disagrees}</td>
          <td className="p-2">{row.agreementRate === null ? copy.noVerdicts : `${(row.agreementRate * 100).toFixed(1)}%`}</td>
          <td className="p-2">{row.modelCodeDifferences}</td><td className="p-2">{row.codeRefusals}</td></tr>)}</tbody>
      </table></div>
      {result.cohorts.map(row => Object.entries(row.refusalReasons).length > 0 && <p key={row.cohort} className="mt-3 break-words text-xs text-ink-3">{copy.cohorts[row.cohort]}: {Object.entries(row.refusalReasons).map(([rule, n]) => `${rule}: ${n}`).join(" · ")}</p>)}
    </>}
  </div>;
}
