"use client";

import { useState } from "react";
import { MAX_ASK_QUESTION_CHARS } from "@/lib/ask-input";

export function ResearchRequest({ mode, budget, version, total }: {
  mode: "quick" | "deep"; budget: number; version: string; total: number;
}) {
  const [question, setQuestion] = useState("");
  const [copied, setCopied] = useState("");
  const request = JSON.stringify({ question: question.trim(), budget, researchMode: mode, packageVersion: version, responseMode: "async" }, null, 2);
  return <div className="mt-6 border-t border-line pt-5">
    <label htmlFor="research-question" className="font-mono text-xs">Question for your buyer agent</label>
    <textarea id="research-question" value={question} onChange={(event) => { setQuestion(event.target.value); setCopied(""); }} maxLength={MAX_ASK_QUESTION_CHARS} rows={3} placeholder="What should your agent research?" className="mt-2 w-full border border-line bg-paper-2 p-3 font-serif" />
    <p className="mt-3 font-serif text-sm text-ink-2">Send this JSON to <code>POST /api/agent/ask</code> with your x402 client. Check the challenge against {total} USDC, Arc testnet and the expected Keryx payee before signing. Keep the returned job ID to open it below.</p>
    <pre className="mt-4 overflow-x-auto border border-line bg-paper-2 p-4 text-xs">{request}</pre>
    <button disabled={!question.trim()} onClick={async () => {
      try { await navigator.clipboard.writeText(request); setCopied("Request copied. No payment was made."); }
      catch { setCopied("Copy unavailable. Select the JSON above to copy it."); }
    }} className="mt-3 border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">Copy request JSON</button>
    <p role="status" className="mt-2 font-serif text-sm">{copied}</p>
  </div>;
}
