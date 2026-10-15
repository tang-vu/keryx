"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useRef, useState } from "react";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";
import { buyerRequestSchema } from "@/lib/buyer/protocol";
import { quoteBuyer } from "@/lib/buyer/quote";
import { paidResearchAvailabilityCopy as availabilityCopy } from "@/locales/en/paid-research-availability";
import { ResearchCheckout } from "./research-checkout";
import { currentArcLabel } from "@/lib/arc-network-display";

const copy = createMessages("en");
const richCopy = createRichMessages("en");

type ResearchRequestProps = {
  mode: "quick" | "deep"; budget: number; version: string; total: number; payee: string;
};

export function ResearchRequest(props: ResearchRequestProps) {
  // A changed package or merchant discards its entire preparation and pending quote.
  return <ResearchRequestForm key={JSON.stringify([props.mode, props.budget, props.version, props.total, props.payee])} {...props} />;
}

function ResearchRequestForm({ mode, budget, version, total, payee }: ResearchRequestProps) {
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState("");
  const [verifiedRequest, setVerifiedRequest] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const operation = useRef<AbortController | null>(null);
  const parsed = buyerRequestSchema.safeParse({ question, budget, researchMode: mode, packageVersion: version, responseMode: "async" });
  const requestKey = parsed.success ? JSON.stringify(parsed.data) : null;
  const ready = requestKey !== null && verifiedRequest === requestKey;
  const request = JSON.stringify({ question: question.trim(), budget, researchMode: mode, packageVersion: version, responseMode: "async" }, null, 2);

  useEffect(() => () => { operation.current?.abort(); operation.current = null; }, []);

  async function checkQuote() {
    if (!parsed.success || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setVerifiedRequest(null); setChecking(true); setStatus(availabilityCopy.checking);
    try {
      const amount = String(Math.round(total * 1e6));
      const requirement = await quoteBuyer(parsed.data, payee, amount, undefined, controller.signal);
      // quoteBuyer enforces the pinned resource, rail, merchant and ceiling. A lower
      // price is still a changed review, so require the displayed total exactly.
      if (requirement.amount !== amount) throw new Error("Quote price changed");
      if (controller.signal.aborted || operation.current !== controller) return;
      setVerifiedRequest(requestKey); setStatus(availabilityCopy.ready);
    } catch {
      if (!controller.signal.aborted && operation.current === controller) setStatus(availabilityCopy.unavailable);
    } finally {
      if (operation.current === controller) { operation.current = null; setChecking(false); }
    }
  }

  return <div className="mt-6 border-t border-line pt-5">
    <label htmlFor="research-question" className="font-mono text-xs">{copy("researchRequest.question")}</label>
    <textarea id="research-question" value={question} onChange={(event) => {
      operation.current?.abort(); operation.current = null;
      setVerifiedRequest(null); setChecking(false); setStatus("");
      setQuestion(event.target.value); setCopied("");
    }} maxLength={MAX_ASK_QUESTION_CHARS} rows={3} placeholder={copy("researchRequest.placeholder")} className="mt-2 w-full border border-line bg-paper-2 p-3 font-serif" />
    <p className="mt-3 font-serif text-sm text-ink-2">{availabilityCopy.preparation}</p>
    {!ready && <button type="button" disabled={!parsed.success || checking} onClick={() => { void checkQuote(); }} className="mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{checking ? availabilityCopy.checking : availabilityCopy.checkQuote}</button>}
    <p role="status" aria-live="polite" className="mt-3 font-serif text-sm">{status}</p>
    {ready && <ResearchCheckout question={question} mode={mode} budget={budget} version={version} total={total} payee={payee} />}
    <details className="mt-5"><summary className="cursor-pointer font-mono text-xs">{copy("researchRequest.ownAgent")}</summary>
    <p className="mt-3 font-serif text-sm text-ink-2">{richCopy("researchRequest.protocolNotice", { endpoint: <code>POST /api/agent/ask</code>, amount: total, network: currentArcLabel })}</p>
    <pre className="mt-4 overflow-x-auto border border-line bg-paper-2 p-4 text-xs">{request}</pre>
    <button disabled={!question.trim()} onClick={async () => {
      try { await navigator.clipboard.writeText(request); setCopied(copy("researchRequest.copied")); }
      catch { setCopied(copy("researchRequest.copyUnavailable")); }
    }} className="mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{copy("researchRequest.copy")}</button>
    <button disabled={!question.trim()} onClick={() => {
      const url = URL.createObjectURL(new Blob([request + "\n"], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "request.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }} className="ml-3 mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">{copy("researchRequest.download")}</button>
    <p className="mt-3 font-serif text-sm text-ink-2">{richCopy("researchRequest.guideNotice", { guideLink: <a className="underline" href="https://github.com/tang-vu/keryx/blob/main/docs/buyer-agent.md" target="_blank" rel="noopener noreferrer">{copy("researchRequest.buyerGuide")}</a>, network: currentArcLabel })}</p>
    <p role="status" className="mt-2 font-serif text-sm">{copied}</p>
    </details>
  </div>;
}
