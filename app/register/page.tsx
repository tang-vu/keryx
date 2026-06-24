"use client";

/**
 * Register — creator onboarding. Gated behind wallet connect + SIWE sign-in.
 * The connected wallet address pre-fills the walletAddress field so creators
 * use their own wallet (not a server-generated custodial one).
 *
 * Auth states:
 *   - not connected → prompt to connect (link to /connect)
 *   - connected, not signed in → prompt to sign in
 *   - signed in (any role) → show the register form
 *
 * Listing is permissionless: any signed-in wallet may register a source, and
 * doing so makes it a creator (role re-derives from source ownership). There is
 * no creator precondition — that would be an impossible bootstrap.
 */

import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import { ShieldCheck, Wallet } from "lucide-react";
import { SiteHeader } from "@/components/keryx/site-header";
import { RegisterForm } from "@/components/keryx/register-form";
import {
  SourcesList,
  type SourceCardData,
} from "@/components/keryx/sources-list";
import type { Session } from "@/lib/auth";

export default function RegisterPage() {
  const { address, isConnected } = useAccount();
  const [sources, setSources] = useState<SourceCardData[]>([]);
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = loading

  // Check whether we already have a valid session cookie on mount.
  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { session: Session } | null) => {
        setSession(data?.session ?? null);
      })
      .catch(() => setSession(null));
  }, []);

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/sources", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { sources: SourceCardData[] };
      setSources(data.sources ?? []);
    } catch {
      /* ignore transient errors */
    }
  }, []);

  useEffect(() => {
    (async () => {
      await loadSources();
    })();
  }, [loadSources]);

  // Permissionless: any signed-in wallet may list its first source (which then
  // makes it a creator). No creator-role precondition.
  const canRegister = !!session;

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <header className="mb-9 max-w-2xl">
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            Become a source
          </div>
          <h1 className="letterpress mt-2.5 max-w-[16ch] font-display text-[clamp(34px,6vw,68px)] font-medium leading-[0.96] tracking-[-0.01em] text-ink">
            Set your <em className="italic text-paid">toll.</em>
          </h1>
          <p className="mt-3 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
            AI agents already read blogs like yours to answer questions — for
            free. List a site you control, and every time Keryx cites it the toll
            settles to you directly. Instant, no middleman, no minimum.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,440px)_1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            {/* Auth gate — show form only when signed in with appropriate role */}
            {session === undefined && (
              <AuthPlaceholder message="Checking session…" />
            )}

            {session === null && !isConnected && (
              <AuthGate
                heading="Connect your wallet first"
                body="You need to connect and sign in with your creator wallet before registering a source."
                cta="Connect wallet ▸"
                href="/connect"
              />
            )}

            {session === null && isConnected && (
              <AuthGate
                heading="Sign in to continue"
                body="Connect your wallet to Keryx to register a source. Your wallet address becomes your payout address."
                cta="Sign in ▸"
                href="/connect"
              />
            )}

            {canRegister && (
              <>
                {/* Show which wallet will be used as the payout address */}
                <div className="mb-4 flex items-center gap-2 border border-line bg-paper-2 px-3 py-2.5">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-paid" />
                  <div className="min-w-0">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                      Payout wallet (your connected address)
                    </p>
                    <p className="truncate font-mono text-[11px] text-ink">
                      {address}
                    </p>
                  </div>
                </div>
                <RegisterForm
                  onCreated={loadSources}
                  prefillWalletAddress={address}
                />
              </>
            )}
          </div>

          <section>
            <h2 className="mb-4 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">
              Registered sources ({sources.length})
            </h2>
            <SourcesList sources={sources} />
          </section>
        </div>
      </main>
    </div>
  );
}

function AuthPlaceholder({ message }: { message: string }) {
  return (
    <div className="border border-line bg-paper-2 p-7">
      <p className="font-mono text-[12px] text-ink-3">{message}</p>
    </div>
  );
}

function AuthGate({
  heading,
  body,
  cta,
  href,
}: {
  heading: string;
  body: string;
  cta: string;
  href: string;
}) {
  return (
    <div className="border border-ink bg-paper p-7 space-y-5">
      <div className="flex items-start gap-3">
        <Wallet className="mt-0.5 h-5 w-5 shrink-0 text-seal" />
        <div>
          <p className="font-display text-lg font-medium text-ink">{heading}</p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{body}</p>
        </div>
      </div>
      <Link
        href={href}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none"
      >
        {cta}
      </Link>
    </div>
  );
}
