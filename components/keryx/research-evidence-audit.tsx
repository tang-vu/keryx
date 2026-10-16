"use client";

import { useRef, useState } from "react";
import { auditResearchEvidence, type ResearchEvidenceAudit } from "@/lib/research-audit/evidence-audit";
import { MAX_EVIDENCE_AUDIT_BYTES, evidenceAuditTrust } from "@/lib/research-audit/evidence-audit-contract";
import sample from "@/docs/research-evidence-audit-example.json";
import { evidenceAuditCopy as copy } from "@/locales/en/evidence-audit";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


const ratioText = (value: { numeratorMicros: string; denominatorSupportedClaims: number } | null, unit: string) =>
  value ? copy.ratio({ amount: value.numeratorMicros, unit, count: value.denominatorSupportedClaims }) : copy.unknown;

/** Local memory only. Inputs are never uploaded, placed in a URL or saved to browser storage. */
export function ResearchEvidenceAuditWorkspace() {
  const copy = useUiCopy("evidence-audit", uiEnglish_copy);
  const [input, setInput] = useState("");
  const [trust, setTrust] = useState("");
  const [result, setResult] = useState<ResearchEvidenceAudit | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  function invalidate() { revision.current++; setResult(null); setError(""); setBusy(false); }
  async function audit() {
    const generation = revision.current;
    setBusy(true); setError(""); setResult(null);
    try {
      if (new TextEncoder().encode(trust).byteLength > 262_144) throw Error();
      const anchor = trust.trim() ? evidenceAuditTrust.parse(JSON.parse(trust)) : {};
      const observation = await auditResearchEvidence(input, anchor);
      if (generation === revision.current) setResult(observation);
    } catch {
      if (generation === revision.current) setError(copy.refused);
    } finally { if (generation === revision.current) setBusy(false); }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "keryx-local-evidence-audit.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const button = "rounded border border-ink/25 px-4 py-2 text-sm disabled:opacity-40";
  return <section className="mt-8 space-y-5" aria-label={copy.region}>
    <p className="max-w-3xl text-sm text-ink-2">{copy.help}</p>
    <div className="flex flex-wrap gap-3">
      <button className={button} onClick={() => { invalidate(); setInput(JSON.stringify(sample, null, 2)); setTrust(""); }}>{copy.sample}</button>
      <button className={button} onClick={() => { invalidate(); setInput(""); setTrust(""); }}>{copy.clear}</button>
      <a className={button} href="https://github.com/tang-vu/keryx/blob/main/docs/research-evidence-audit.md" target="_blank" rel="noreferrer">{copy.instructions}</a>
    </div>
    <label className="block text-sm font-medium">{copy.input}
      <textarea aria-label={copy.input} spellCheck={false} autoComplete="off" maxLength={MAX_EVIDENCE_AUDIT_BYTES}
        value={input} onChange={event => { invalidate(); setInput(event.target.value); }}
        className="mt-2 min-h-72 w-full rounded border border-ink/20 bg-paper p-3 font-mono text-xs" />
    </label>
    <label className="block text-sm font-medium">{copy.trust}
      <textarea aria-label={copy.trust} spellCheck={false} autoComplete="off" maxLength={262_144}
        value={trust} onChange={event => { invalidate(); setTrust(event.target.value); }}
        className="mt-2 min-h-24 w-full rounded border border-ink/20 bg-paper p-3 font-mono text-xs" />
    </label>
    <p className="text-sm text-ink-2">{copy.trustHelp}</p>
    <button className={button} disabled={busy || !input.trim()} onClick={audit}>{busy ? copy.busy : copy.check}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <div aria-live="polite" className="space-y-5 rounded border border-ink/20 bg-paper p-4 sm:p-6">
      <h2 className="font-display text-2xl">{copy.result}</h2>
      <p className="break-all text-xs">{copy.receipt({ check: result.receiptCheck, digest: result.receiptDigest })}</p>
      <p className="text-sm">{copy.networkReview({ network: result.network, review: result.reviewBasis })}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm text-ink-2">{copy.supported}</dt><dd>{result.economics.supportedClaims} / {result.economics.claimPopulation}</dd></div>
        <div><dt className="text-sm text-ink-2">{copy.sourceRatio}</dt><dd className="break-words">{ratioText(result.economics.sourceCostPerSupportedClaim, "USDC")}</dd></div>
        <div><dt className="text-sm text-ink-2">{copy.providerRatio}</dt><dd className="break-words">{ratioText(result.economics.providerCostPerSupportedClaim, "USD")}</dd></div>
        <div><dt className="text-sm text-ink-2">{copy.providerBasis}</dt><dd>{result.economics.providerCostStatus}</dd></div>
        {(["llm", "search", "other"] as const).map(kind => <div key={kind}>
          <dt className="text-sm text-ink-2">{copy.component[kind]}</dt>
          <dd className="break-words">{result.economics[kind].status === "unknown" ? copy.unknown :
            copy.cost({ amount: result.economics[kind].amountMicroUsd, status: result.economics[kind].status })}</dd>
        </div>)}
      </dl>
      <p className="text-sm">{copy.sourceTotals({ access: result.economics.accessMicroUsdc, citation: result.economics.citationMicroUsdc, window: result.economics.ledgerCostComplete ? copy.availableWindow : copy.unknownWindow })}</p>
      <h3 className="font-medium">{copy.comparisons}</h3>
      {result.decisionLinks.length ? result.decisionLinks.map(row => <div key={row.decisionId} className="space-y-1 border-t border-ink/15 pt-3 text-xs">
        <p className="break-all">{row.decisionId} · {row.commitmentCheck}</p>
        <p>{copy.comparison({ access: row.access, citation: row.citation, timing: row.temporalProof })}</p>
        <p className="break-all">{row.commitment}</p>
      </div>) : <p className="text-sm text-ink-2">{copy.noDecisions}</p>}
      <p className="text-sm">{copy.unmatched({ count: result.unmatchedCreatorPayments })}</p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-ink-2">{result.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
      <button className={button} onClick={download}>{copy.download}</button>
    </div>}
  </section>;
}
