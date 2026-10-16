import React, { useRef, useState } from "react";
import type { DesktopAPI, SponsoredResearchResult } from "./contracts";
import { createMessages } from "../../lib/i18n/messages";

const copy = createMessages("en");

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
    <button type="button" className="secondary" onClick={() => { field.current?.focus(); field.current?.select(); }}>{copy("nativeDesktop.sponsored.selectUrl")}</button>
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
      setMessage(copy("nativeDesktop.sponsored.waitNotice"));
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

  return <section className="sponsored-screen" aria-label={copy("nativeDesktop.sponsored.title")}>
    <div className="page-heading"><div><span className="eyebrow">{copy("nativeDesktop.sponsored.eyebrow")}</span><h1>{copy("nativeDesktop.sponsored.title")}</h1><p>{copy("nativeDesktop.sponsored.introduction")}</p></div></div>
    <section className="panel sponsored-form-panel">
      <div className="panel-heading"><div><h2>{copy("nativeDesktop.sponsored.questionTitle")}</h2><p>{copy("nativeDesktop.sponsored.publicBoundary")}</p></div></div>
      {unavailable && <p className="sponsored-helper-wait" role="status">{copy("nativeDesktop.sponsored.helperWait")}</p>}
      <form onSubmit={ask}>
        <fieldset disabled={busy || unavailable} className="sponsored-fields">
          <label className="field">{copy("nativeDesktop.sponsored.question")}<textarea required maxLength={2000} rows={3} value={question} placeholder={copy("nativeDesktop.sponsored.questionPlaceholder")} onChange={event => setQuestion(event.target.value)}/></label>
          <fieldset className="mode-field"><legend>{copy("nativeDesktop.sponsored.depth")}</legend><div className="mode-options">{(["quick", "deep"] as const).map(value => <label key={value} className={mode === value ? "mode-option selected" : "mode-option"}><input type="radio" name="sponsored-mode" value={value} checked={mode === value} onChange={() => setMode(value)}/><span><strong>{value === "quick" ? copy("nativeDesktop.task.quick") : copy("nativeDesktop.task.deep")}</strong><small>{value === "quick" ? copy("nativeDesktop.sponsored.quickHint") : copy("nativeDesktop.sponsored.deepHint")}</small></span></label>)}</div></fieldset>
          <label className="field sponsored-budget">{copy("nativeDesktop.sponsored.sourceBudget")}<input required type="number" inputMode="decimal" min="0" max="0.08" step="any" value={budget} onChange={event => setBudget(event.target.value)}/><small>{copy("nativeDesktop.sponsored.sourceBudgetBoundary")}</small></label>
          <label className="sponsored-consent"><input type="checkbox" required checked={publicReport} onChange={event => setPublicReport(event.target.checked)}/><span>{copy("nativeDesktop.sponsored.consent")}</span></label>
        </fieldset>
        <div className="form-footer"><span>{copy("nativeDesktop.sponsored.submissionBoundary")}</span><button type="submit" className="primary" disabled={busy || unavailable || !valid}>{state === "pending" ? copy("nativeDesktop.sponsored.asking") : copy("nativeDesktop.sponsored.ask")}</button></div>
      </form>
    </section>
    {state === "pending" && <p className="activity" role="status">{copy("nativeDesktop.sponsored.waiting")}</p>}
    {message && <div className="alert error" role="alert"><span>{message}</span></div>}
    {state === "uncertain" && <div className="sponsored-uncertain" role="status"><strong>{copy("nativeDesktop.sponsored.uncertain")}</strong>{copy("nativeDesktop.sponsored.uncertainBoundary")}</div>}
    {result && <section className="panel sponsored-result" aria-label={copy("nativeDesktop.sponsored.resultLabel")}>
      <div className="panel-heading"><div><span className="eyebrow">{copy("nativeDesktop.sponsored.answerEyebrow")}</span><h2>{copy("nativeDesktop.sponsored.resultTitle")}</h2></div></div>
      <div className="answer"><p>{result.answer}</p></div>
      <div className="sponsored-citations"><h3>{copy("nativeDesktop.sponsored.citations")}</h3>{result.citations.length ? <ol>{result.citations.map((citation, index) => <li key={index}><strong>{citation.sourceName}</strong>{publicUrl(citation.sourceUrl) && <SelectableUrl label={copy("nativeDesktop.sponsored.citationUrl", { number: index + 1 })} url={publicUrl(citation.sourceUrl)!}/>}</li>)}</ol> : <p>{copy("nativeDesktop.sponsored.noCitations")}</p>}</div>
      <div className="sponsored-receipt"><strong>{copy("nativeDesktop.sponsored.receiptTitle")}</strong><p>{copy("nativeDesktop.sponsored.receiptBoundary")}</p></div>
    </section>}
    {report && <section className="panel sponsored-report"><div className="panel-heading"><div><h2>{copy("nativeDesktop.sponsored.reportTitle")}</h2><p>{copy("nativeDesktop.sponsored.reportHint")}</p></div></div><SelectableUrl label={copy("nativeDesktop.sponsored.reportUrl")} url={report}/></section>}
  </section>;
}
