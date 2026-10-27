"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowUpRight, LockKeyhole, ShieldCheck } from "lucide-react";
import { evaluateMandate, type MandateAssessment, type MandateInput } from "@/lib/research-mandate/evaluate";
import { mandateExample } from "@/lib/research-mandate/example";
import { mandateCopy, mandateReasonsVi, mandateProtocolCopy as protocol } from "@/locales/en/research-mandates";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { downloadBrowserText } from "@/lib/browser-text-download";
const uiEnglish_mandateCopy = mandateCopy;
const uiEnglish_mandateReasonsVi = mandateReasonsVi;
const uiEnglish_protocol = protocol;


const button = "rounded-md border border-current/20 px-4 py-2 text-sm transition-colors hover:bg-current/5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#176247]";
const primaryButton = button.replace("hover:bg-current/5", "hover:bg-[#114b36]") + " bg-[#176247] text-white disabled:opacity-40";
type Scenario = "ready" | "overdue" | "pending" | "recipient" | "unknown";
export function ResearchMandateWorkspace() {
  const message = useUiMessages();
  const mandateCopy = useUiCopy("research-mandates", uiEnglish_mandateCopy);
  const mandateReasonsVi = useUiCopy("research-mandates", uiEnglish_mandateReasonsVi);
  const protocol = useUiCopy("research-mandates", uiEnglish_protocol);
  const [language, setLanguage] = useState<"en" | "vi">("en");
  const [text, setText] = useState("");
  const [sample, setSample] = useState(false);
  const [result, setResult] = useState<MandateAssessment | null>(null);
  const [error, setError] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const copy = mandateCopy[language];
  function update(value: string) { setText(value); setResult(null); setError(false); setDownloadError(""); }
  function load(scenario: Scenario) {
    const input = mandateExample();
    if (scenario === "ready") input.policy.liabilities = [];
    if (scenario === "overdue") { input.proposal.amountUsdc = "5"; input.books.balanceUsdc = "45"; }
    if (scenario === "pending") {
      input.books.heldUsdc = "8"; input.books.dailyCommittedUsdc = "8";
      input.books.rollingWeekCommittedUsdc = "8"; input.books.lifetimeCommittedUsdc = "8";
      input.books.categoryCommittedUsdc["source-access"] = "8";
      input.books.taskCommittedUsdc[input.proposal.taskHash] = "8";
    }
    if (scenario === "recipient") { input.proposal.payee = "0x2222222222222222222222222222222222222222"; input.policy.payees.push(input.proposal.payee); }
    if (scenario === "unknown") input.books.complete = false;
    update(JSON.stringify(input, null, 2)); setSample(true);
  }
  const parsed = (() => { try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && typeof value.proposal?.amountUsdc === "string" &&
      typeof value.books?.balanceUsdc === "string" ? value as MandateInput : null;
  } catch { return null; } })();
  function edit(field: "amount" | "balance", value: string) {
    if (!parsed?.proposal || !parsed?.books) return;
    const next = field === "amount" ? { ...parsed, proposal: { ...parsed.proposal, amountUsdc: value } }
      : { ...parsed, books: { ...parsed.books, balanceUsdc: value } };
    update(JSON.stringify(next, null, 2));
  }
  function assess() {
    try {
      if (new TextEncoder().encode(text).byteLength > 65_536) throw new Error("Input too large");
      setResult(evaluateMandate(JSON.parse(text))); setError(false);
    } catch { setResult(null); setError(true); }
  }
  function download(name: string, content: unknown) {
    setDownloadError("");
    try { downloadBrowserText(JSON.stringify(content, null, 2), name, "application/json"); }
    catch { setDownloadError(message("evidenceMatrix.downloadUnavailable")); }
  }
  const status = result ? ({ "within-supplied-policy": copy.within, hold: copy.hold, skip: copy.skip, review: copy.review })[result.assessment] : null;
  return <main className="mx-auto max-w-6xl px-5 py-8 sm:px-10 sm:py-12" lang={language}>
    <div className="flex items-center justify-between gap-4 border-b border-current/20 pb-5">
      <Link href="/" prefetch={false} className="inline-flex items-center gap-2 text-sm underline-offset-4 hover:underline"><ArrowLeft size={14} />{copy.home}</Link>
      <div className="flex gap-2" aria-label={copy.language}><button className={button} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>{protocol.english}</button><button className={button} aria-pressed={language === "vi"} onClick={() => setLanguage("vi")}>{protocol.vietnamese}</button></div>
    </div>
    <header className="grid gap-6 py-10 sm:py-14 lg:grid-cols-[1.4fr_1fr]">
      <div><p className="font-mono text-xs uppercase tracking-[0.18em] text-[#176247]">{copy.eyebrow}</p>
        <h1 className="mt-4 max-w-2xl font-[family-name:var(--font-bodoni)] text-4xl leading-tight sm:text-6xl">{copy.title}</h1>
        <p className="mt-5 max-w-xl text-lg opacity-80">{copy.intro}</p></div>
      <aside className="self-end border-l-2 border-[#176247]/40 pl-6"><ShieldCheck size={30} className="mb-4 text-[#176247]" /><p className="leading-relaxed">{copy.explanation}</p><p className="mt-4 font-mono text-xs uppercase tracking-wide opacity-65">{copy.status}</p></aside>
    </header>
    {downloadError && <p role="alert" className="mb-5 text-sm text-red-800">{downloadError}</p>}
    <section aria-label={copy.workspace} className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
      <div className="rounded-xl border border-current/20 bg-white/35 p-5 sm:p-7">
        <h2 className="text-xl">{copy.scenarios}</h2>
        <div className="my-4 flex flex-wrap gap-2">{(["ready", "overdue", "pending", "recipient", "unknown"] as const).map(id => <button key={id} className={button} onClick={() => load(id)}>{copy[id]}</button>)}</div>
        <p className="mb-5 text-sm opacity-70">{sample ? copy.sample : copy.reset}</p>
        {parsed?.proposal && parsed?.books && <div className="mb-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">{copy.amount}<input className="mt-2 w-full rounded border border-current/25 bg-white/50 px-3 py-2 font-mono" inputMode="decimal" value={parsed.proposal.amountUsdc ?? ""} onChange={event => edit("amount", event.target.value)} /></label>
          <label className="text-sm">{copy.balance}<input className="mt-2 w-full rounded border border-current/25 bg-white/50 px-3 py-2 font-mono" inputMode="decimal" value={parsed.books.balanceUsdc ?? ""} onChange={event => edit("balance", event.target.value)} /></label>
        </div>}
        <details open={!text}><summary className="cursor-pointer text-sm underline underline-offset-4">{copy.input}</summary>
          <textarea aria-label={copy.input} spellCheck={false} className="mt-3 h-80 w-full resize-y rounded border border-current/25 bg-white/55 p-3 font-mono text-xs leading-relaxed" value={text} maxLength={65_536} onChange={event => { update(event.target.value); setSample(false); }} /></details>
        <div className="mt-5 flex flex-wrap gap-3"><button className={primaryButton} onClick={assess} disabled={!text}>{copy.assess}</button>
          <button className={button} onClick={() => parsed && download("keryx-mandate-policy.json", parsed)} disabled={!parsed}>{copy.policyExport}</button></div>
        {error && <p role="alert" className="mt-4 text-sm text-red-800">{copy.invalid}</p>}
        <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed opacity-70"><LockKeyhole size={14} className="mt-0.5 shrink-0" />{copy.privacy}</p>
      </div>
      <div className="rounded-xl border border-current/20 p-5 sm:p-7" aria-live="polite">
        <p className="font-mono text-xs uppercase tracking-wide opacity-60">{copy.result}</p>
        <h2 className="mt-3 text-3xl">{status ?? "—"}</h2>
        <p className="mt-4 text-sm leading-relaxed opacity-80">{copy.disclaimer}</p>
        {result && <>
          <dl className="my-6 divide-y divide-current/15 border-y border-current/15">{([
            [copy.reserve, result.cash.protectedReserveUsdc], [copy.exposure, result.cash.heldUsdc],
            [copy.purchase, result.cash.proposedUsdc], [copy.required, result.cash.requiredUsdc],
          ] as const).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-3 py-3"><dt className="text-sm">{label}</dt><dd className="font-mono text-sm">{value} {protocol.currency}</dd></div>)}</dl>
          {result.reasons.length > 0 && <ul className="mb-5 space-y-3 text-sm">{result.reasons.map((reason, index) => <li key={index}><span className="font-mono text-xs text-[#176247]">{reason.code}</span><p className="mt-1 opacity-80">{language === "vi" ? mandateReasonsVi[reason.code] ?? reason.message : reason.message}</p></li>)}</ul>}
          <button className={button + " inline-flex items-center gap-2"} onClick={() => download("keryx-mandate-assessment.json", result)}><ArrowDownToLine size={15} />{copy.export}</button>
          <details className="mt-6"><summary className="cursor-pointer text-sm underline underline-offset-4">{copy.trace}</summary><dl className="mt-4 space-y-4 text-xs">{[[copy.timestamp, result.evaluatedAt], [copy.identity, result.identity.decisionHash], [copy.binding, result.identity.purchaseBinding], [copy.calldata, result.prepareCalldata ?? "—"]].map(([label, value]) => <div key={label}><dt className="opacity-65">{label}</dt><dd className="mt-1 max-h-28 overflow-auto break-all font-mono">{value}</dd></div>)}</dl></details>
        </>}
      </div>
    </section>
    <section className="mt-10 border-t border-current/20 pt-7"><h2 className="text-2xl">{copy.agents}</h2><p className="mt-3 max-w-3xl opacity-75">{copy.agentText}</p>
      <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2"><div className="rounded border border-current/20 p-4"><p className="mb-2 font-mono text-xs opacity-60">{protocol.http}</p><code className="break-all">{protocol.api}</code><br /><code className="break-all">{protocol.mcp}</code></div>
        <div className="rounded border border-current/20 p-4"><p className="mb-2 font-mono text-xs opacity-60">{protocol.cli}</p><code className="break-all">{protocol.command}</code></div></div>
      <a href="https://github.com/tang-vu/keryx/blob/main/docs/research-mandates.md" className="mt-5 inline-flex items-center gap-1 text-sm underline underline-offset-4">{copy.docs}<ArrowUpRight size={14} /></a>
    </section>
  </main>;
}
