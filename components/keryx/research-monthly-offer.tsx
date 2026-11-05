"use client";

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { fetchMonthlyQuote } from "@/lib/monthly/client";
import type { MonthlyQuote } from "@/lib/monthly/protocol";
import { useUiCopyFunction, useUiMessages } from "@/lib/i18n/ui-copy";
import { productGuideCopy } from "@/locales/en/product-guide";

const MonthlyCheckout = lazy(() => import("./research-monthly").then(module => ({ default: module.ResearchMonthly })));

/** A page visit has no paid admission effect. Only this explicit price check
 * loads the existing guarded quote and, after validation, the wallet/plan UI. */
export function ResearchMonthlyOffer() {
  const copy = useUiMessages();
  const guide = useUiCopyFunction("product-guide", productGuideCopy);
  const [quote, setQuote] = useState<MonthlyQuote | null>(null);
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => { operation.current?.abort(); operation.current = null; }, []);

  async function checkPrice() {
    if (operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    setChecking(true); setStatus("");
    try {
      const current = await fetchMonthlyQuote((input, init) => fetch(input, { ...init,
        signal: init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal }));
      if (controller.signal.aborted || operation.current !== controller) return;
      setQuote(current);
    } catch {
      if (!controller.signal.aborted && operation.current === controller) setStatus(copy("researchCheckout.quoteChanged"));
    } finally {
      if (operation.current === controller) { operation.current = null; setChecking(false); }
    }
  }

  if (quote) return <Suspense fallback={<p role="status">{copy("researchEntry.checking")}</p>}>
    <MonthlyCheckout quote={quote} />
  </Suspense>;

  return <section id="monthly" aria-labelledby="monthly-heading" className="space-y-4 border border-line bg-paper p-6">
    <h2 id="monthly-heading" className="font-display text-3xl">{copy("monthlyResearch.title")}</h2>
    <button type="button" disabled={checking} aria-busy={checking} onClick={() => { void checkPrice(); }}
      className="border border-ink px-4 py-2 font-mono text-xs disabled:opacity-40">
      {checking ? copy("researchEntry.checking") : guide("pricing.checkout")}
    </button>
    <p role="status" aria-live="polite" className="font-serif text-sm">{status}</p>
  </section>;
}
