"use client";

/**
 * Shared top navigation + dispatch wire. Sticky ivory nav with a hairline ink
 * rule; Ask / Ledger are quiet mono links (vermillion underline when active),
 * "Issue a toll" is the inked vermillion call to action. On mobile (< md),
 * the nav collapses into a hamburger menu with a slide-down panel.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeryxWordmark } from "./keryx-mark";
import { DispatchWire } from "./dispatch-wire";
import { WalletMenu } from "./wallet-menu";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Ask a question" },
  { href: "/dashboard", label: "Payments & proof" },
  { href: "/answers", label: "Past answers" },
  { href: "/sources", label: "Sources" },
  { href: "/market", label: "Market" },
  { href: "/integrations/mcp", label: "MCP" },
  { href: "/wanted", label: "Wanted" },
  { href: "/register", label: "For creators" },
  { href: "/me/sources", label: "My sources" },
  { href: "/me/asks", label: "My dispatches" },
  { href: "/playground", label: "Playground" },
  { href: "/research", label: "Paid research" },
  { href: "/dev", label: "Dev portal" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Close menu on route change
  useEffect(() => {
    const timer = window.setTimeout(() => setMenuOpen(false), 0);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // Close on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const toggle = useCallback(() => setMenuOpen((v) => !v), []);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-ink bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex h-[66px] max-w-[1180px] items-center justify-between gap-6 px-4 sm:px-[30px]">
          <Link href="/" className="transition-opacity hover:opacity-80">
            <KeryxWordmark />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.slice(0, 4).map((link) => {
              const active =
                link.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    "border-b-[1.5px] px-2 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors",
                    active
                      ? "border-seal text-ink"
                      : "border-transparent text-ink-3 hover:text-ink"
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
            <Link
              href="/register"
              className="ml-2 border border-ink bg-seal px-3 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-paper transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none"
            >
              For creators ▸
            </Link>
            <div className="ml-2">
              <WalletMenu />
            </div>
          </nav>

          {/* Mobile hamburger */}
          <div className="flex items-center lg:hidden" ref={menuRef}>
            <button
              ref={menuButton}
              type="button"
              onClick={toggle}
              className="flex h-11 w-11 items-center justify-center border border-line text-ink-3 transition-colors hover:border-ink hover:text-ink"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-site-menu"
            >
              {menuOpen ? (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M4 4l10 10M14 4L4 14" />
                </svg>
              ) : (
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 18 18"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M2 4h14M2 9h14M2 14h14" />
                </svg>
              )}
            </button>

            {/* Slide-down menu */}
            {menuOpen && (
              <div id="mobile-site-menu" className="absolute left-0 right-0 top-[66px] z-50 max-h-[calc(100dvh-66px)] overflow-y-auto overscroll-contain border-b border-ink bg-paper shadow-lg">
                <nav className="mx-auto flex max-w-[1180px] flex-col px-4 py-3" aria-label="Mobile navigation">
                  <span className="px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-seal">Explore</span>
                  {NAV.slice(0, 4).map((link) => {
                    const active =
                      link.href === "/"
                        ? pathname === "/"
                        : pathname.startsWith(link.href);
                    return (
                      <Link
                        key={link.href}
                        href={link.href}
                        className={cn(
                          "flex min-h-11 items-center border-l-2 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.08em] transition-colors",
                          active
                            ? "border-seal text-ink"
                            : "border-transparent text-ink-3 hover:text-ink"
                        )}
                      >
                        {link.label}
                      </Link>
                    );
                  })}
                  <Link href="/register" className={cn("flex min-h-11 items-center border-l-2 px-4 py-2 font-mono text-[12px] uppercase tracking-[0.08em]", pathname.startsWith("/register") ? "border-seal text-ink" : "border-transparent text-seal")}>For creators</Link>
                  <details className="mt-2 border-t border-line pt-2">
                    <summary className="flex min-h-11 cursor-pointer items-center px-4 font-mono text-[11px] uppercase tracking-wider text-ink">More tools</summary>
                    {NAV.slice(4).filter((link) => link.href !== "/register").map((link) => <Link key={link.href} href={link.href} className="flex min-h-11 items-center px-4 font-mono text-[11px] uppercase text-ink-2">{link.label}</Link>)}
                  </details>
                  <div className="mt-3 border-t border-line px-4 pt-3">
                    <WalletMenu />
                  </div>
                </nav>
              </div>
            )}
          </div>
        </div>
      </header>
      <DispatchWire />
    </>
  );
}
