import React, { useRef, useState } from "react";
import type { DesktopAPI, SponsoredResearchResult } from "./contracts";

// A renderer deadline never cancels the native/helper operation or releases the
// submission lock. Only a confirmed response can do that.
export const SPONSORED_WAIT_NOTICE_MS = 300_000;

function publicUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value);
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) return url.href;
  } catch { /* An invalid URL remains plain text. */ }
}

export function sponsoredReportUrl(value: unknown, queryId: unknown): string | undefined {
  if (typeof value !== "string" || typeof queryId !== "string" || !/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|a2a_[0-9a-f]{64})$/.test(queryId)) return;
  return value === `https://keryx.cc/dispatch/${queryId}` || value === `https://keryx.cc/ask/${queryId}` ? value : undefined;
}

function SelectableUrl({ label, url }: { label: string; url: string }) {
  const field = useRef<HTMLInputElement>(null);
  return <div className="sponsored-url">
    <label className="field">{label}<input ref={field} readOnly value={url} onFocus={event => event.currentTarget.select()}/></label>
    <button type="button" className="secondary" onClick={() => { field.current?.focus(); field.current?.select(); }}>Select URL</button>
  </div>;
}

export function SponsoredResearch({ api, unavailable = false }: { api: Pick<DesktopAPI, "researchSponsored">; unavailable?: boolean }) {
  const [question, setQuestion] = useState("");
  const [mode, setMode] = useState<"quick" | "deep">("quick");
  const [budget, setBudget] = useState("0.05");
  const [publicReport, setPublicReport] = useState(false);
  const [state, setState] = useState<"idle" | "pending" | "uncertain">("idle");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<SponsoredResearchResult | null>(null);
  const [recovery, setRecovery] = useState<{ queryId?: string; dispatchUrl?: string } | null>(null);
  const locked = useRef(false);
  const busy = state !== "idle";
  const amount = budget.trim() ? Number(budget) : NaN;
  const valid = !!question.trim() && question.length <= 2000 && publicReport
    && Number.isFinite(amount) && amount >= 0 && amount <= 0.08;

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (locked.current || unavailable || !valid) return;
    locked.current = true;
    setState("pending"); setMessage(""); setResult(null); setRecovery(null);
    const timer = setTimeout(() => {
      setMessage("Still waiting for confirmation. The hosted request may still be running. Ask stays locked; do not submit the same question again.");
    }, SPONSORED_WAIT_NOTICE_MS);
    try {
      const outcome = await api.researchSponsored({ question: question.trim(), mode, budget: amount, publicReport: true });
      if (outcome.ok) {
        setResult(outcome.result);
        setMessage("");
        locked.current = false; setState("idle"); setPublicReport(false);
      } else {
        setMessage(outcome.message);
        setRecovery({ queryId: outcome.queryId, dispatchUrl: outcome.dispatchUrl });
        if (outcome.uncertain) setState("uncertain");
        else { locked.current = false; setState("idle"); setPublicReport(false); }
      }
    } catch (error) {
      // Lost IPC or a host timeout is not a confirmed refusal. The helper or
      // hosted service may still be working; never enable an accidental resend.
      setMessage(error instanceof Error ? error.message : String(error));
      setState("uncertain");
    } finally { clearTimeout(timer); }
  }

  const report = result ? sponsoredReportUrl(result.dispatchUrl, result.queryId)
    : sponsoredReportUrl(recovery?.dispatchUrl, recovery?.queryId);

  return <section className="sponsored-screen" aria-label="Sponsored research">
    <div className="page-heading"><div><span className="eyebrow">PUBLIC HOSTED RESEARCH</span><h1>Sponsored research</h1><p>Ask a shareable question. Keryx pays within shared limits; availability, source budgets and service pauses are enforced by the hosted service.</p></div></div>
    <section className="panel sponsored-form-panel">
      <div className="panel-heading"><div><h2>What would you like to learn?</h2><p>No API key or wallet is needed. Questions and results become public trial reports. Private local tasks and references are not attached.</p></div></div>
      {unavailable && <p className="sponsored-helper-wait" role="status">Waiting for the desktop helper to become available.</p>}
      <form onSubmit={ask}>
        <fieldset disabled={busy || unavailable} className="sponsored-fields">
          <label className="field">Shareable question<textarea required maxLength={2000} rows={3} value={question} placeholder="Type a question suitable for a public report" onChange={event => setQuestion(event.target.value)}/></label>
          <fieldset className="mode-field"><legend>Research depth</legend><div className="mode-options">{(["quick", "deep"] as const).map(value => <label key={value} className={mode === value ? "mode-option selected" : "mode-option"}><input type="radio" name="sponsored-mode" value={value} checked={mode === value} onChange={() => setMode(value)}/><span><strong>{value === "quick" ? "Quick" : "Deep"}</strong><small>{value === "quick" ? "A focused answer" : "A broader investigation"}</small></span></label>)}</div></fieldset>
          <label className="field sponsored-budget">Source budget (USDC)<input required type="number" inputMode="decimal" min="0" max="0.08" step="any" value={budget} onChange={event => setBudget(event.target.value)}/><small>0 to 0.08 USDC. Zero uses free sources. This source cap is separate from model and search costs; the server may apply a lower cap.</small></label>
          <label className="sponsored-consent"><input type="checkbox" required checked={publicReport} onChange={event => setPublicReport(event.target.checked)}/><span>I agree to publish this question and its result as a public trial report.</span></label>
        </fieldset>
        <div className="form-footer"><span>Sent to https://keryx.cc. No automatic retry or paid buyer fallback. Public results are not saved to private workspace journals.</span><button type="submit" className="primary" disabled={busy || unavailable || !valid}>{state === "pending" ? "Asking…" : "Ask"}</button></div>
      </form>
    </section>
    {state === "pending" && <p className="activity" role="status">Waiting for hosted research. This can take up to five minutes. Keep this window open.</p>}
    {message && <div className="alert error" role="alert"><span>{message}</span></div>}
    {state === "uncertain" && <div className="sponsored-uncertain" role="status"><strong>Completion is uncertain.</strong> The hosted request may continue after a timeout or disconnect. Ask is locked for this session. Keep any original report URL below and inspect it before deciding whether to ask again. No request was automatically resent.</div>}
    {result && <section className="panel sponsored-result" aria-label="Sponsored research result">
      <div className="panel-heading"><div><span className="eyebrow">HOSTED ANSWER</span><h2>Research result</h2></div></div>
      <div className="answer"><p>{result.answer}</p></div>
      <div className="sponsored-citations"><h3>Citations</h3>{result.citations.length ? <ol>{result.citations.map((citation, index) => <li key={index}><strong>{citation.sourceName}</strong>{publicUrl(citation.sourceUrl) && <SelectableUrl label={`Citation ${index + 1} URL`} url={publicUrl(citation.sourceUrl)!}/>}</li>)}</ol> : <p>No citations were returned.</p>}</div>
      <div className="sponsored-receipt"><strong>Receipt status: hosted report</strong><p>A budget or reward allocation is not proof of payment. Inspect the public report for recorded receipts and settlement evidence. Pending or planned rewards are not settled payments.</p></div>
    </section>}
    {report && <section className="panel sponsored-report"><div className="panel-heading"><div><h2>Public report</h2><p>Select a URL, press Ctrl+C, and paste it into your browser.</p></div></div><SelectableUrl label="Public report URL" url={report}/></section>}
  </section>;
}
