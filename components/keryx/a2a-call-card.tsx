"use client";

/**
 * "Call Keryx from your own agent" — a copy-paste integration card on the
 * dashboard. External agents calling the paid A2A endpoint are the top traction
 * lever, yet the contract was only reachable by hand (a link to /api/docs).
 * This surfaces the exact two-step x402 call so an outside agent can wire up in
 * one glance. Facts mirror GET /api/agent/ask, which stays the live source of
 * truth (the inspect step prints the real price + schema).
 */



import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Terminal } from "lucide-react";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { useUiCopy, useUiMessages } from "@/lib/i18n/ui-copy";
import { setupCopy } from "@/locales/en/get-started";





const ORIGIN = "https://keryx.cc";

const SNIPPET = `# 1 · inspect the default package — free, no payment
curl -s ${ORIGIN}/api/agent/ask

# 2 · POST body sets the exact quote, then pay via x402
circle services pay ${ORIGIN}/api/agent/ask -X POST
#    body → {"question":"...","budget":0.05,"researchMode":"deep",
#             "packageVersion":"1.0.0","responseMode":"async"}
#    Deep v1: 4 attention slots · 1 re-evaluation · provisional target 300s
#    default Deep total: $0.05 service + $0.05 creator cap = $0.10`;

export function A2aCallCard() {
  const message = useUiMessages();
  const setup = useUiCopy("get-started", setupCopy);
  const [status, setStatus] = useState<"idle" | "pending" | "copied" | "failed">("idle");
  const example = useRef<HTMLPreElement>(null);
  const mounted = useRef(true), copyPending = useRef(false);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; window.clearTimeout(resetTimer.current); };
  }, []);

  async function copy() {
    if (copyPending.current) return;
    copyPending.current = true;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = undefined;
    setStatus("pending");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(SNIPPET);
      if (!mounted.current) return;
      setStatus("copied");
      resetTimer.current = window.setTimeout(() => {
        resetTimer.current = undefined;
        if (mounted.current) setStatus("idle");
      }, 2000);
    } catch {
      if (!mounted.current) return;
      setStatus("failed");
      example.current?.focus();
      try {
        const selection = window.getSelection();
        if (example.current && selection) {
          const range = document.createRange(); range.selectNodeContents(example.current);
          selection.removeAllRanges(); selection.addRange(range);
        }
      } catch { /* The focused example remains available for manual selection. */ }
    } finally {
      copyPending.current = false;
    }
  }

  return (
    <section className="mt-6 border border-ink bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3.5">
        <h2 className="font-display text-[19px] font-medium text-ink">
          {message("agentIntegration.title")}
        </h2>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          {message("agentIntegration.endpoint", { endpoint: "POST /api/agent/ask", network: browserPaymentProfile().networkId })}
        </span>
      </div>

      <p className="px-5 pt-3.5 text-sm leading-relaxed text-ink-2">
        {message("agentIntegration.packageNotice")}
      </p>

      <div className="relative m-5 mt-3.5 border border-line bg-paper-2">
        <button
          type="button"
          onClick={() => { void copy(); }}
          title={message("agentIntegration.copyTitle")}
          aria-label={message("agentIntegration.copyTitle")}
          aria-busy={status === "pending"} aria-disabled={status === "pending"}
          className="absolute right-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border border-line bg-paper px-3 py-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-seal hover:text-seal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal aria-disabled:cursor-wait motion-reduce:transition-none"
        >
          {status === "copied" ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {status === "copied" ? message("agentIntegration.copied") : message("agentIntegration.copy")}
        </button>
        <pre ref={example} tabIndex={0} aria-label={message("agentIntegration.title")} className="max-w-full overflow-x-auto px-4 pb-3.5 pt-16 font-mono text-[12px] leading-relaxed text-ink focus-visible:outline-2 focus-visible:outline-seal">
          <code>{SNIPPET}</code>
        </pre>
      </div>
      <p role="status" aria-atomic="true" className={`mb-4 min-h-4 px-5 font-mono text-xs leading-relaxed ${status === "failed" ? "text-seal" : "text-paid"}`}>
        {status === "failed" ? setup.common.copyFailed : status === "copied" ? message("agentIntegration.copied") : ""}
      </p>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-5 py-3 font-mono text-[11px] text-ink-3">
        <Terminal size={13} className="text-seal" />
        <span className="text-ink-2">{message("agentIntegration.remoteTools")}</span>
        <code className="break-all text-ink">claude mcp add --transport http keryx &quot;https://keryx.cc/mcp?client=claude&quot;</code>
        <Link
          href="/integrations/mcp"
          className="font-semibold text-seal hover:underline"
        >
          {message("agentIntegration.setupLink")}
        </Link>
        <span>{message("agentIntegration.payerNotice")}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 font-mono text-[11px] text-ink-3">
        <Terminal size={13} className="text-seal" />
        {message("agentIntegration.schemaLinkNotice")}
        <a
          href="/api/docs"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-seal hover:underline"
        >
          /api/docs ↗
        </a>
      </div>
    </section>
  );
}
