"use client";

/**
 * Shared top navigation — sticky, ivory-translucent, active-link aware. Ask and
 * Dashboard are quiet text links with a vermillion underline when active;
 * "Register a source" is the inked primary call to action.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeryxWordmark } from "./keryx-mark";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Ask" },
  { href: "/dashboard", label: "Dashboard" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/[0.86] backdrop-blur-md backdrop-saturate-150">
      <div className="mx-auto flex h-[66px] max-w-6xl items-center justify-between gap-6 px-4 sm:px-8">
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
                  "border-b-2 px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors",
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
            className="ml-2 border border-ink bg-ink px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--seal)]"
          >
            Register a source
          </Link>
        </nav>
      </div>
    </header>
  );
}
