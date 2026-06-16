/**
 * Landing marketing sections: "How a dispatch settles" (Decide / Cite / Settle)
 * and the "For creators" pitch with an illustrative payout receipt.
 */

import Link from "next/link";

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

export function HowItWorks() {
  return (
    <section className="border-y border-line bg-paper-2">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
        <div className="mb-8 font-mono text-[12px] uppercase tracking-[0.2em] text-ink-3">
          How a dispatch settles
        </div>
        <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.title} className="bg-card p-7 sm:p-8">
              <div className="font-serif text-[40px] italic leading-none text-seal">
                {s.numeral}
              </div>
              <div className="mb-2 mt-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
                {s.title}
              </div>
              <p className="text-[16px] leading-relaxed text-ink-2">{s.body}</p>
            </div>
          ))}
        </div>
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
          <h2 className="max-w-[16ch] text-balance font-serif text-[clamp(30px,4vw,46px)] font-normal leading-[1.08] tracking-[-0.015em] text-ink">
            Your words are the answer.{" "}
            <em className="italic text-seal">Get paid like it.</em>
          </h2>
          <p className="mt-5 max-w-[46ch] text-[18px] leading-relaxed text-ink-2">
            Register a source, set a price per read, and connect a wallet. Every
            time an agent cites you, the toll settles to you directly — no
            platform, no payout schedule, no minimum.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3.5">
            <Link
              href="/register"
              className="rounded-md bg-seal px-6 py-3 text-[15px] font-semibold text-cream shadow-[0_10px_22px_-12px_rgba(197,64,42,0.7)] transition hover:brightness-105"
            >
              Register a source
            </Link>
            <Link
              href="/dashboard"
              className="rounded-md border border-line px-5 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper-2"
            >
              See a creator dashboard
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-card p-6 shadow-[0_18px_40px_-28px_rgba(33,30,24,0.4)]">
          <div className="flex justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
            <span>Receipt</span>
            <span>USDC · Arc</span>
          </div>
          <div className="mt-3.5 flex flex-col gap-3 border-t border-line-2 pt-4">
            {RECEIPT.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <span className="font-serif text-[16px] text-ink">{r.label}</span>
                <span className="font-mono text-[15px] text-paid">{r.amount}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-baseline justify-between border-t-[1.5px] border-ink pt-3.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink-2">
              Settled today
            </span>
            <span className="font-mono text-[22px] tabular-nums text-ink">$0.055</span>
          </div>
        </div>
      </div>
    </section>
  );
}
