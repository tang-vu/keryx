"use client";

import { useRef, useState } from "react";
import { auditResearchEvidence, type ResearchEvidenceAudit } from "@/lib/research-audit/evidence-audit";
import { MAX_EVIDENCE_AUDIT_BYTES, evidenceAuditTrust } from "@/lib/research-audit/evidence-audit-contract";
import sample from "@/docs/research-evidence-audit-example.json";

const ratioText = (value: { numeratorMicros: string; denominatorSupportedClaims: number } | null, unit: string) =>
  value ? `${value.numeratorMicros} micro-${unit} / ${value.denominatorSupportedClaims} supported claims` : "Unknown";

/** Local memory only. Inputs are never uploaded, placed in a URL or saved to browser storage. */
export function ResearchEvidenceAuditWorkspace() {
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
      if (generation === revision.current) setError("Audit unavailable. Check the JSON, receipt digest, exact evidence references and selected network.");
    } finally { if (generation === revision.current) setBusy(false); }
  }
  function download() {
    if (!result) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2) + "\n"], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "keryx-local-evidence-audit.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const button = "rounded border border-ink/25 px-4 py-2 text-sm disabled:opacity-40";
  return <section className="mt-8 space-y-5" aria-label="Local evidence audit">
    <p className="max-w-3xl text-sm text-ink-2">Paste a portable receipt with its review, cost records and captured decisions. Checking runs in this browser. Data stays in this tab until you clear it or leave. A downloaded result can contain private cost references.</p>
    <div className="flex flex-wrap gap-3">
      <button className={button} onClick={() => { invalidate(); setInput(JSON.stringify(sample, null, 2)); setTrust(""); }}>Load illustrative example</button>
      <button className={button} onClick={() => { invalidate(); setInput(""); setTrust(""); }}>Clear data</button>
      <a className={button} href="https://github.com/tang-vu/keryx/blob/main/docs/research-evidence-audit.md" target="_blank" rel="noreferrer">Input instructions</a>
    </div>
    <label className="block text-sm font-medium">Audit input JSON
      <textarea aria-label="Audit input JSON" spellCheck={false} autoComplete="off" maxLength={MAX_EVIDENCE_AUDIT_BYTES}
        value={input} onChange={event => { invalidate(); setInput(event.target.value); }}
        className="mt-2 min-h-72 w-full rounded border border-ink/20 bg-paper p-3 font-mono text-xs" />
    </label>
    <label className="block text-sm font-medium">Separately retained digests JSON (optional)
      <textarea aria-label="Separately retained digests JSON (optional)" spellCheck={false} autoComplete="off" maxLength={262_144}
        value={trust} onChange={event => { invalidate(); setTrust(event.target.value); }}
        className="mt-2 min-h-24 w-full rounded border border-ink/20 bg-paper p-3 font-mono text-xs" />
    </label>
    <p className="text-sm text-ink-2">Use digests retained outside the supplied input to detect later changes. A matching digest alone cannot establish when a decision happened or prove that payment settled.</p>
    <button className={button} disabled={busy || !input.trim()} onClick={audit}>{busy ? "Checking…" : "Check locally"}</button>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <div aria-live="polite" className="space-y-5 rounded border border-ink/20 bg-paper p-4 sm:p-6">
      <h2 className="font-display text-2xl">Local audit result</h2>
      <p className="break-all text-xs">Receipt: {result.receiptCheck} · {result.receiptDigest}</p>
      <p className="text-sm">Network: {result.network} · Review: {result.reviewBasis}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-sm text-ink-2">Supported claims in supplied review</dt><dd>{result.economics.supportedClaims} / {result.economics.claimPopulation}</dd></div>
        <div><dt className="text-sm text-ink-2">Source cost per supported claim (USDC)</dt><dd className="break-words">{ratioText(result.economics.sourceCostPerSupportedClaim, "USDC")}</dd></div>
        <div><dt className="text-sm text-ink-2">LLM + search + other cost per supported claim (USD)</dt><dd className="break-words">{ratioText(result.economics.providerCostPerSupportedClaim, "USD")}</dd></div>
        <div><dt className="text-sm text-ink-2">Provider cost basis</dt><dd>{result.economics.providerCostStatus}</dd></div>
        {(["llm", "search", "other"] as const).map(kind => <div key={kind}>
          <dt className="text-sm text-ink-2">{kind === "llm" ? "LLM" : kind === "search" ? "Search" : "Other allocated costs"} (USD)</dt>
          <dd className="break-words">{result.economics[kind].status === "unknown" ? "Unknown" :
            `${result.economics[kind].amountMicroUsd} micro-USD · ${result.economics[kind].status}`}</dd>
        </div>)}
      </dl>
      <p className="text-sm">Receipt-recorded settled access: {result.economics.accessMicroUsdc} micro-USDC. Citation rewards: {result.economics.citationMicroUsdc} micro-USDC. Full source-cost window: {result.economics.ledgerCostComplete ? "available" : "unknown"}.</p>
      <h3 className="font-medium">Decision → receipt comparisons</h3>
      {result.decisionLinks.length ? result.decisionLinks.map(row => <div key={row.decisionId} className="space-y-1 border-t border-ink/15 pt-3 text-xs">
        <p className="break-all">{row.decisionId} · {row.commitmentCheck}</p>
        <p>Access: {row.access} · Citation: {row.citation} · Independent timing proof: {row.temporalProof}</p>
        <p className="break-all">{row.commitment}</p>
      </div>) : <p className="text-sm text-ink-2">No captured decisions supplied. Historical records are not reconstructed.</p>}
      <p className="text-sm">Creator payments without an identity match: {result.unmatchedCreatorPayments}.</p>
      <ul className="list-disc space-y-2 pl-5 text-sm text-ink-2">{result.limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
      <button className={button} onClick={download}>Download local result</button>
    </div>}
  </section>;
}
