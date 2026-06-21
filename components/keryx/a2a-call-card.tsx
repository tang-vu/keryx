"use client";

/**
 * "Call Keryx from your own agent" — a copy-paste integration card on the
 * dashboard. External agents calling the paid A2A endpoint are the top traction
 * lever, yet the contract was only reachable by hand (a link to /api/docs).
 * This surfaces the exact two-step x402 call so an outside agent can wire up in
 * one glance. Facts mirror GET /api/agent/ask, which stays the live source of
 * truth (the inspect step prints the real price + schema).
 */

import { useState } from "react";
import { Check, Copy, Terminal } from "lucide-react";

const ORIGIN = "https://keryx.cc";

const SNIPPET = `# 1 · inspect the toll — free, no payment
curl -s ${ORIGIN}/api/agent/ask

# 2 · pay $0.02 USDC on Arc, then ask (x402)
circle services pay ${ORIGIN}/api/agent/ask -X POST
#    body → {"question": "...", "budget": 0.05}`;

export function A2aCallCard() {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(SNIPPET).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <section className="mt-6 border border-ink bg-paper">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-3.5">
        <h2 className="font-display text-[19px] font-medium text-ink">
          Call Keryx from your own agent
        </h2>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
          POST /api/agent/ask · $0.02 USDC · Arc eip155:5042002
        </span>
      </div>

      <p className="px-5 pt-3.5 text-sm leading-relaxed text-ink-2">
        Keryx is itself a paid x402 endpoint. Your agent pays the $0.02 toll; Keryx runs its full
        reasoning loop, answers with citations, and pays the creators it cites — downstream, on Arc.
        Inbound A2A fees count as external traction, kept separate from the autonomous engine.
      </p>

      <div className="relative m-5 mt-3.5 border border-line bg-paper-2">
        <button
          type="button"
          onClick={copy}
          title="Copy to clipboard"
          className="absolute right-2 top-2 inline-flex items-center gap-1.5 border border-line bg-paper px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-seal hover:text-seal"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "copied" : "copy"}
        </button>
        <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12px] leading-relaxed text-ink">
          <code>{SNIPPET}</code>
        </pre>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 font-mono text-[11px] text-ink-3">
        <Terminal size={13} className="text-seal" />
        Full schema, response shape, and the SDK path (GatewayClient.pay) →
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
