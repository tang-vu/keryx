"use client";

import { createMessages } from "@/lib/i18n/messages";

const message = createMessages("en");

import { useEffect, useState } from "react";
import { verifyBrowserDecisions, type BuyerDecisions } from "@/lib/a2a/buyer-decisions";
import { readBoundedJson } from "@/lib/read-bounded-json";

export function ResearchDecisions({ queryId, answer, claims }: {
  queryId: string;
  answer: string;
  claims: { claimIndex: number; claim: string }[];
}) {
  const [decisions, setDecisions] = useState<BuyerDecisions | null>(null);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 20_000);
    let active = true;
    setDecisions(null); setError(false);
    void (async () => {
      try {
        const response = await fetch(`/api/dispatch/${encodeURIComponent(queryId)}/receipt`, {
          signal: abort.signal, cache: "no-store", credentials: "omit", redirect: "error",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Receipt unavailable");
        const next = await verifyBrowserDecisions(await readBoundedJson(response), response.headers.get("x-keryx-receipt-digest"), queryId, answer);
        if (active && !abort.signal.aborted) setDecisions(next);
        else if (active) setError(true);
      } catch {
        if (active) setError(true);
      } finally { clearTimeout(timer); }
    })();
    return () => { active = false; clearTimeout(timer); abort.abort(); };
  }, [queryId, answer, revision]);

  return <details className="border border-line p-4">
    <summary className="cursor-pointer"><h3 className="inline font-display text-2xl">{decisions ? message(decisions.length === 1 ? "researchDecisions.count.one" : "researchDecisions.count.other", { count: decisions.length }) : message("researchDecisions.title")}</h3></summary>
    <p className="mt-2 font-serif text-sm text-ink-3">{message("researchDecisions.boundary")}</p>
    {decisions !== null && <p role="status" className="mt-2 font-mono text-xs">{message("researchDecisions.integrityNotice")}</p>}
    {error ? <div role="status" className="mt-3 font-serif text-sm">
      {message("researchDecisions.failed")}
      <button type="button" onClick={() => setRevision(value => value + 1)} className="ml-3 border border-ink px-3 py-2 font-mono text-xs">{message("researchDecisions.retry")}</button>
    </div> : decisions === null ? <p role="status" className="mt-3 font-mono text-xs">{message("researchDecisions.loading")}</p>
      : decisions.length === 0 ? <p className="mt-3 font-serif">{message("researchDecisions.empty")}</p>
      : <ol className="mt-4 space-y-3">{decisions.map((decision, index) => <li key={index} className="border border-line p-4">
        <p className="font-mono text-xs">{message("researchDecisions.quotedPrice", { action: decision.action, amount: decision.priceUsdc.toFixed(6) })}</p>
        <p className="mt-2 font-serif font-semibold">{decision.sourceName}{decision.itemTitle && decision.sourceName !== decision.itemTitle && !decision.sourceName.endsWith(` — ${decision.itemTitle}`) ? ` — ${decision.itemTitle}` : ""}</p>
        <p className="mt-2 font-serif">{decision.rationale}</p>
        {!!decision.targets.length && <ul className="mt-3 list-inside list-disc font-serif text-sm text-ink-3">{decision.targets.map((target, i) => <li key={i}>{claims.find(claim => claim.claimIndex === target)?.claim ?? message("researchDecisions.unavailableTarget", { number: target + 1 })}</li>)}</ul>}
      </li>)}</ol>}
  </details>;
}
