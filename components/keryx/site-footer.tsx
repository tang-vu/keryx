/**
 * The colophon — panel-toned footer with the coin, the Keryx etymology, and the
 * house / rails link columns.
 */

import Link from "next/link";
import { KeryxGlyph } from "./keryx-mark";

const HOUSE = [
  { label: "Ask", href: "/" },
  { label: "Ledger", href: "/dashboard" },
  { label: "Issue a toll", href: "/register" },
  { label: "Documents", href: "https://github.com/circlefin/arc-nanopayments" },
];

const RAILS = ["x402 protocol", "USDC", "Arc network", "Status"];

export function SiteFooter() {
  return (
    <footer className="border-t border-ink bg-panel">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-[54px] sm:px-[30px]">
        <div className="grid gap-10 md:grid-cols-[1.6fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3">
              <KeryxGlyph size={24} reeded={false} />
              <span className="font-display text-[21px] font-bold leading-none text-ink">
                Keryx
              </span>
            </div>
            <p className="mt-4 max-w-[42ch] font-serif text-[16px] leading-[1.55] text-ink-3">
              From the Greek{" "}
              <span className="italic text-ink">κῆρυξ</span> — a herald: the one
              sent to carry a message, and paid for the carrying.
            </p>
          </div>

          <div>
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
              The house
            </div>
            <div className="flex flex-col gap-2.5 font-serif text-[15px] text-ink">
              {HOUSE.map((h) => (
                <Link key={h.label} href={h.href} className="transition-colors hover:text-seal">
                  {h.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
              The rails
            </div>
            <div className="flex flex-col gap-2.5 font-serif text-[15px] text-ink">
              {RAILS.map((r) => (
                <span key={r}>{r}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-ink pt-5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
          <span>© 2026 Keryx — legal tender for attention</span>
          <span className="text-seal">Creators paid every time a machine cites them</span>
        </div>
      </div>
    </footer>
  );
}
