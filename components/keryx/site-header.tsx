"use client";

/**
 * Shared top navigation + dispatch wire. Sticky ivory nav with a hairline ink
 * rule; Ask / Ledger are quiet mono links (vermillion underline when active),
 * "Issue a toll" is the inked vermillion call to action.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeryxWordmark } from "./keryx-mark";
import { DispatchWire } from "./dispatch-wire";
import { WalletMenu } from "./wallet-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/dashboard", label: "Ledger" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-ink bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between gap-6 px-4 sm:px-[30px]">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <KeryxWordmark />
          </Link>
          <nav className="flex items-center gap-1.5">
            {NAV.map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "border-b-[1.5px] px-3 py-2 font-mono text-[11.5px] uppercase tracking-[0.14em] transition-colors",
                    active
                      ? "border-seal text-ink"
                      : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/register"
              className="ml-3 hidden border border-ink bg-seal px-[18px] py-2.5 font-mono text-[11.5px] font-semibold uppercase tracking-[0.12em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none sm:inline-block"
            >
              Issue a toll ▸
            </Link>
            <div className="ml-2">
              <WalletMenu />
            </div>
          </nav>
        </div>
      </header>
      <DispatchWire />
    </>
  );
}
