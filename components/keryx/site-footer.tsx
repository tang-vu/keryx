/**
 * The colophon — panel-toned footer with the coin, the Keryx etymology, and the
 * house / docs link columns. Internal routes use next/link; external + the /api/docs
 * route handler open in a new tab. On-chain links point at verifiable Arc testnet artifacts.
 */

import Link from "next/link";
import { KeryxGlyph } from "./keryx-mark";

const EXPLORER = "https://testnet.arcscan.app";
const REGISTRY = "0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536";
const USDC = "0x3600000000000000000000000000000000000000";

type FooterLink = { label: string; href: string; external?: boolean };

// Product surfaces. "API for agents" is the OpenAPI reference (also the A2A entry point).
const HOUSE: FooterLink[] = [
  { label: "Ask the herald", href: "/" },
  { label: "The ledger", href: "/dashboard" },
  { label: "Issue a toll", href: "/register" },
  { label: "API for agents ↗", href: "/api/docs", external: true },
];

// Docs + verifiable on-chain proof. The registry contract is verified source on ArcScan.
const DOCS: FooterLink[] = [
  { label: "GitHub ↗", href: "https://github.com/tang-vu/keryx", external: true },
  { label: "Registry contract ↗", href: `${EXPLORER}/address/${REGISTRY}#code`, external: true },
  { label: "USDC on Arc ↗", href: `${EXPLORER}/address/${USDC}`, external: true },
  { label: "x402 + Gateway ↗", href: "https://github.com/circlefin/arc-nanopayments", external: true },
  { label: "Arc network ↗", href: "https://docs.arc.network", external: true },
];

function FooterCol({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <div className="mb-3.5 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ink-3">
        {title}
      </div>
      <div className="flex flex-col gap-2.5 font-serif text-[15px] text-ink">
        {links.map((l) =>
          l.external ? (
            <a
              key={l.label}
              href={l.href}
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-seal"
            >
              {l.label}
            </a>
          ) : (
            <Link key={l.label} href={l.href} className="transition-colors hover:text-seal">
              {l.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

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

          <FooterCol title="The house" links={HOUSE} />
          <FooterCol title="Docs & proof" links={DOCS} />
        </div>

        <div className="mt-10 flex flex-wrap justify-between gap-3 border-t border-ink pt-5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
          <span>© 2026 Keryx — legal tender for attention</span>
          <span className="text-seal">Creators paid every time a machine cites them</span>
        </div>
      </div>
    </footer>
  );
}
