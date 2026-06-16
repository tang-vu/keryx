"use client";

/**
 * Register — creator onboarding. Paste an RSS feed (or add manually) to get a
 * payout wallet and start earning when an AI cites you. Lists current sources.
 */

import { useCallback, useEffect, useState } from "react";
import { SiteHeader } from "@/components/keryx/site-header";
import { RegisterForm } from "@/components/keryx/register-form";
import {
  SourcesList,
  type SourceCardData,
} from "@/components/keryx/sources-list";

export default function RegisterPage() {
  const [sources, setSources] = useState<SourceCardData[]>([]);

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
    // Async IIFE keeps the initial fetch off the synchronous render path.
    (async () => {
      await loadSources();
    })();
  }, [loadSources]);

  return (
    <div className="min-h-screen bg-paper">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        <header className="mb-9 max-w-2xl">
          <div className="font-mono text-[12px] uppercase tracking-[0.2em] text-seal">
            Become a source
          </div>
          <h1 className="letterpress mt-2.5 max-w-[18ch] font-display text-[clamp(30px,4vw,46px)] font-medium tracking-tight text-ink">
            Set your toll. Get paid per citation.
          </h1>
          <p className="mt-3 max-w-[54ch] text-[18px] leading-relaxed text-ink-2">
            List a source you control. When Keryx reads and cites it, the toll
            settles to your wallet in USDC — instantly, with no middleman.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,440px)_1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <RegisterForm onCreated={loadSources} />
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
