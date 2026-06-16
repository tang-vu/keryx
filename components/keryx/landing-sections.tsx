/**
 * Landing marketing sections: "How a dispatch settles" (Decide / Cite / Settle
 * struck as banknote plates with Bodoni numerals), a running protocol ticker,
 * and the "For creators" pitch with an illustrative payout receipt.
 */

import Link from "next/link";
import { Ticker } from "./banknote";

const STEPS = [
  {
    numeral: "i",
    title: "Decide",
    body: "Given a budget, Keryx ranks paid sources by relevance and price, then buys only the set worth reading. Unspent budget is returned.",
  },
  {
    numeral: "ii",
    title: "Cite",
    body: "It reads what it bought and answers your question, attaching a citation to every claim — each one traceable back to the source it came from.",
  },
  {
    numeral: "iii",
    title: "Settle",
    body: "A weighted nanopayment clears to each cited source in USDC on Arc — proportional to how much it shaped the answer. Sub-second, sub-cent.",
  },
];

const TICKER = [
  "x402 · HTTP 402 PAYMENT REQUIRED",
  "USDC ON ARC · CHAIN 5042002",
  "SUB-SECOND SETTLEMENT",
  "WEIGHTED BY CONTRIBUTION",
  "MULTI-AUTHOR SPLITS",
  "NO ACCOUNTS · NO INVOICES · NO CLICKS",
  "THE HERALD IS PAID · ΚΗΡΥΞ",
];

export function HowItWorks() {
  return (
    <section className="border-y border-line bg-paper-2">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
        <div className="mb-8 font-mono text-[12px] uppercase tracking-[0.2em] text-ink-3">
          How a dispatch settles
        </div>
        <div className="grid border border-ink bg-ink sm:grid-cols-3 [&>*+*]:border-t [&>*+*]:border-ink sm:[&>*+*]:border-l sm:[&>*+*]:border-t-0">
          {STEPS.map((s) => (
            <div key={s.title} className="bg-paper p-7 sm:p-8">
              <div className="letterpress font-display text-[44px] font-semibold italic leading-none text-seal">
                {s.numeral}
              </div>
              <div className="mb-2 mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                {s.title}
              </div>
              <p className="font-serif text-[16px] leading-[1.55] text-ink-2">
                {s.body}
              </p>
            </div>
          ))}
        </div>
        <Ticker items={TICKER} className="mt-8 border-y border-line py-3" />
      </div>
    </section>
  );
}

const RECEIPT = [
  { label: "Cited in “x402 & stablecoins…”", amount: "+$0.018" },
  { label: "Cited in “agent budgeting…”", amount: "+$0.020" },
  { label: "Cited in “unit of account…”", amount: "+$0.017" },
];

export function ForCreators() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-8">
      <div className="grid items-center gap-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-4 font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            For creators
          </div>
          <h2 className="letterpress max-w-[16ch] text-balance font-display text-[clamp(30px,4vw,46px)] font-medium leading-[1.06] tracking-[-0.01em] text-ink">
            Your words are the answer.{" "}
            <em className="italic text-seal">Get paid like it.</em>
          </h2>
          <p className="mt-5 max-w-[46ch] font-serif text-[18px] leading-[1.55] text-ink-2">
            Register a source, set a price per read, and connect a wallet. Every
            time an agent cites you, the toll settles to you directly — no
            platform, no payout schedule, no minimum.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3.5">
            <Link
              href="/register"
              className="kx-press border border-ink bg-seal px-6 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none"
            >
              Register a source
            </Link>
            <Link
              href="/dashboard"
              className="border border-ink px-5 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-colors hover:bg-paper-2"
            >
              See the ledger
            </Link>
          </div>
        </div>

        {/* receipt — banknote draft */}
        <div className="border-2 border-ink bg-paper p-[5px]">
          <div className="border border-ink p-6">
            <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
              <span>Receipt</span>
              <span>USDC · Arc</span>
            </div>
            <div className="mt-3.5 flex flex-col gap-3 border-t border-line pt-4">
              {RECEIPT.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-3">
                  <span className="font-serif text-[16px] text-ink">{r.label}</span>
                  <span className="font-mono text-[15px] text-paid">{r.amount}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-ink pt-3.5">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2">
                Settled today
              </span>
              <span className="letterpress font-display text-[28px] font-bold tabular-nums text-paid">
                $0.055
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
