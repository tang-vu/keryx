/**
 * Dark "ink" footer — the colophon. Carries the Keryx etymology and the
 * product/protocol link columns.
 */

import Link from "next/link";
import { KeryxGlyph } from "./keryx-mark";
import { Microprint } from "./banknote";

const PRODUCT = [
  { label: "Ask", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Register a source", href: "/register" },
  { label: "Documentation", href: "https://github.com/circlefin/arc-nanopayments" },
];

const PROTOCOL = ["x402 payments", "USDC settlement", "Arc network", "Status"];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-[#E9E3D6]">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <KeryxGlyph className="text-[#E08B6F]" size={32} />
              <span className="font-display text-[23px] font-medium leading-none text-[#F4EFE4]">
                Keryx
              </span>
            </div>
            <p className="mt-4 max-w-[38ch] font-serif text-[17px] italic leading-relaxed text-[#B8B1A2]">
              From the Greek κῆρυξ, a herald: the one sent to carry a message —
              and paid for the carrying.
            </p>
          </div>

          <div>
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
              Product
            </div>
            <div className="flex flex-col gap-2.5 text-[15px] text-[#C9C2B4]">
              {PRODUCT.map((p) => (
                <Link key={p.label} href={p.href} className="transition-colors hover:text-[#F4EFE4]">
                  {p.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-3.5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-3">
              Protocol
            </div>
            <div className="flex flex-col gap-2.5 text-[15px] text-[#C9C2B4]">
              {PROTOCOL.map((p) => (
                <span key={p}>{p}</span>
              ))}
            </div>
          </div>
        </div>

        <Microprint
          text="KERYX · THE CITATION TOLL · ΚΗΡΥΞ · USDC ON ARC"
          className="mt-10 text-[#6f6451]/70"
        />
        <div className="mt-4 flex flex-wrap justify-between gap-3 border-t border-[#3A352C] pt-5 font-mono text-[11px] tracking-wide text-ink-3">
          <span>© 2026 Keryx</span>
          <span>Creators paid every time an AI cites them.</span>
        </div>
      </div>
    </footer>
  );
}
