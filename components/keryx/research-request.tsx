"use client";



import { useEffect, useRef, useState } from "react";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";
import { buyerRequestSchema } from "@/lib/buyer/protocol";
import { quoteBuyer } from "@/lib/buyer/quote";
import { productGuideCopy } from "@/locales/en/product-guide";
import { ResearchCheckout } from "./research-checkout";
import { currentArcLabel } from "@/lib/arc-network-display";
import { downloadBrowserText } from "@/lib/browser-text-download";
import { useUiCopyFunction, useUiMessages, useUiRichMessages } from "@/lib/i18n/ui-copy";
const uiEnglish_productGuideCopy = productGuideCopy;





type ResearchRequestProps = {
  mode: "quick" | "deep"; budget: number; version: string; total: number; payee: string;
};

export function ResearchRequest(props: ResearchRequestProps) {
  // A changed package or merchant discards its entire preparation and pending quote.
  return <ResearchRequestForm key={JSON.stringify([props.mode, props.budget, props.version, props.total, props.payee])} {...props} />;
}

function ResearchRequestForm({ mode, budget, version, total, payee }: ResearchRequestProps) {
  const copy = useUiMessages();
  const richCopy = useUiRichMessages();
  const productGuideCopy = useUiCopyFunction("product-guide", uiEnglish_productGuideCopy);
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState("");
  const [copyPending, setCopyPending] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const copyAttempt = useRef<symbol | null>(null);
  const [verifiedRequest, setVerifiedRequest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const operation = useRef<AbortController | null>(null);
  const parsed = buyerRequestSchema.safeParse({ question, budget, researchMode: mode, packageVersion: version, responseMode: "async" });
  const requestKey = parsed.success ? JSON.stringify(parsed.data) : null;
  const ready = requestKey !== null && verifiedRequest === requestKey;
  const request = JSON.stringify({ question: question.trim(), budget, researchMode: mode, packageVersion: version, responseMode: "async" }, null, 2);

  useEffect(() => () => { operation.current?.abort(); operation.current = null; copyAttempt.current = null; }, []);

  async function copyRequest() {
    if (copyAttempt.current) return;
    const attempt = Symbol(); copyAttempt.current = attempt; setCopyPending(true); setCopied("");
    try {
      await navigator.clipboard.writeText(request);
      if (copyAttempt.current === attempt) setCopied(copy("researchRequest.copied"));
    } catch {
      if (copyAttempt.current === attempt) setCopied(copy("researchRequest.copyUnavailable"));
    } finally {
      if (copyAttempt.current === attempt) { copyAttempt.current = null; setCopyPending(false); }
    }
  }

  async function checkQuote() {
    if (!parsed.success || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setVerifiedRequest(null); setChecking(true); setStatus(copy("researchEntry.checking"));
    try {
      const amount = String(Math.round(total * 1e6));
      const requirement = await quoteBuyer(parsed.data, payee, amount, undefined, controller.signal);
      // quoteBuyer enforces the pinned resource, rail, merchant and ceiling. A lower
      // price is still a changed review, so require the displayed total exactly.
      if (requirement.amount !== amount) throw new Error("Quote price changed");
      if (controller.signal.aborted || operation.current !== controller) return;
      setVerifiedRequest(requestKey); setStatus("");
    } catch {
      if (!controller.signal.aborted && operation.current === controller) setStatus(copy("researchCheckout.quoteChanged"));
    } finally {
      if (operation.current === controller) { operation.current = null; setChecking(false); }
    }
  }

  return <div className="mt-6 border-t border-line pt-5">
    <label htmlFor="research-question" className="font-mono text-xs">{copy("researchRequest.question")}</label>
    <textarea id="research-question" value={question} onChange={(event) => {
      operation.current?.abort(); operation.current = null;
      setVerifiedRequest(null); setChecking(false); setStatus("");
      copyAttempt.current = null; setCopyPending(false);
      setQuestion(event.target.value); setCopied(""); setDownloadError("");
    }} maxLength={MAX_ASK_QUESTION_CHARS} rows={3} placeholder={copy("researchRequest.placeholder")} className="mt-2 w-full border border-line bg-paper-2 p-3 font-serif" />
    <p className="mt-3 font-serif text-sm text-ink-2">{productGuideCopy("pricing.prepaidBody")}</p>
    {!ready && <button type="button" disabled={!parsed.success || checking} onClick={() => { void checkQuote(); }} className="mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{checking ? copy("researchEntry.checking") : productGuideCopy("pricing.checkout")}</button>}
    <p role="status" aria-live="polite" className="mt-3 font-serif text-sm">{status}</p>
    {ready && <ResearchCheckout question={question} mode={mode} budget={budget} version={version} total={total} payee={payee} />}
    <details className="mt-5"><summary className="cursor-pointer font-mono text-xs">{copy("researchRequest.ownAgent")}</summary>
    <p className="mt-3 font-serif text-sm text-ink-2">{richCopy("researchRequest.protocolNotice", { endpoint: <code>POST /api/agent/ask</code>, amount: total, network: currentArcLabel })}</p>
    <pre className="mt-4 overflow-x-auto border border-line bg-paper-2 p-4 text-xs">{request}</pre>
    <button disabled={!question.trim() || copyPending} aria-busy={copyPending} onClick={() => void copyRequest()} className="mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{copy("researchRequest.copy")}</button>
    <button disabled={!question.trim()} onClick={() => {
      setDownloadError("");
      try { downloadBrowserText(request + "\n", "request.json", "application/json"); }
      catch { setDownloadError(copy("evidenceMatrix.downloadUnavailable")); }
    }} className="ml-3 mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{copy("researchRequest.download")}</button>
    <p className="mt-3 font-serif text-sm text-ink-2">{richCopy("researchRequest.guideNotice", { guideLink: <a className="underline" href="https://github.com/tang-vu/keryx/blob/main/docs/buyer-agent.md" target="_blank" rel="noopener noreferrer">{copy("researchRequest.buyerGuide")}</a>, network: currentArcLabel })}</p>
    <p role="status" className="mt-2 font-serif text-sm">{copied}</p>
    {downloadError && <p role="status" className="mt-2 font-serif text-sm text-seal">{downloadError}</p>}
    </details>
  </div>;
}
