/**
 * Landing marketing sections: "The minting" (Decide / Cite / Settle struck as
 * banknote plates with Bodoni numerals + engraver icons + rosette watermarks)
 * and the treasury-green "For creators" plate.
 */

import Link from "next/link";
import { MintIcon, type MintIconName } from "./mint-icons";
import { cn } from "@/lib/utils";

const STEPS: {
  num: string;
  kicker: string;
  icon: MintIconName;
  body: string;
}[] = [
  {
    num: "I",
    kicker: "Decide",
    icon: "weighted",
    body: "Given a budget, Keryx ranks paid sources by relevance and price, then buys only the set worth reading. Whatever it does not need, it returns.",
  },
  {
    num: "II",
    kicker: "Cite",
    icon: "citation",
    body: "It reads what it bought and answers — fixing a footnote to every claim, each one traceable to the source it came from.",
  },
  {
    num: "III",
    kicker: "Settle",
    icon: "paid",
    body: "A weighted nanopayment clears to each cited source in USDC on Arc, proportional to its contribution. Sub-second, sub-cent.",
  },
];

export function HowItWorks() {
  return (
    <section className="mx-auto max-w-[1180px] px-4 pb-2.5 pt-16 sm:px-[30px]">
      <div className="mb-7 flex items-baseline gap-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-seal">
          The minting
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <div className="grid border border-ink bg-paper sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.kicker}
            className={cn(
              "relative overflow-hidden p-8 sm:p-9",
              i < 2 && "sm:border-r sm:border-ink",
              i > 0 && "border-t border-ink sm:border-t-0",
            )}
          >
            <svg
              viewBox="0 0 200 200"
              className="pointer-events-none absolute -bottom-14 -right-14 h-[200px] w-[200px] text-ink opacity-[0.07]"
            >
              <use href="#eng-rose2" fill="none" stroke="currentColor" strokeWidth="0.5" />
            </svg>
            <span className="absolute right-6 top-8 block h-[26px] w-[26px] text-paid">
              <MintIcon name={s.icon} />
            </span>
            <div className="font-display text-[54px] font-semibold italic leading-none text-seal">
              {s.num}
            </div>
            <div className="mb-2.5 mt-[18px] font-mono text-[11px] uppercase tracking-[0.18em] text-paid">
              {s.kicker}
            </div>
            <p className="relative font-serif text-[16px] leading-[1.55] text-ink-2">
              {s.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ForCreators() {
  return (
    <section className="mx-auto max-w-[1180px] px-4 py-16 sm:px-[30px]">
      <div className="border-2 border-ink bg-paid p-1.5 text-paper">
        <div className="relative overflow-hidden border border-paper/50 p-8 sm:p-14">
          <svg
            viewBox="0 0 200 200"
            className="pointer-events-none absolute -left-10 -top-10 h-[340px] w-[340px] text-paper opacity-[0.12]"
          >
            <use href="#eng-rose1" fill="none" stroke="currentColor" strokeWidth="0.4" />
          </svg>
          <div className="relative font-mono text-[11px] uppercase tracking-[0.2em] text-paper/75">
            For creators
          </div>
          <h2 className="relative mt-4 max-w-[18ch] font-display text-[clamp(32px,5.4vw,72px)] font-medium leading-[0.98] tracking-[-0.01em]">
            Your words are the answer.{" "}
            <em className="font-semibold italic">Be paid like it.</em>
          </h2>
          <p className="relative mt-6 max-w-[54ch] font-serif text-[clamp(16px,1.5vw,19px)] leading-[1.55] text-paper/85">
            Register a source, set a price per read, connect a wallet. Every
            citation settles to you directly — no platform cut, no payout
            schedule, no minimum. The herald always pays.
          </p>
          <div className="relative mt-8 flex flex-wrap gap-3">
            <Link
              href="/register"
              className="border border-paper bg-paper px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_rgba(15,42,30,0.6)] active:translate-y-0 active:shadow-none"
            >
              Issue a toll ▸
            </Link>
            <Link
              href="/dashboard"
              className="border border-paper/55 px-6 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-paper transition-colors hover:bg-paper hover:text-paid"
            >
              See the ledger
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
