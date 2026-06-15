"use client";

/**
 * Register — creator onboarding. Paste an RSS feed (or add manually) to get a
 * payout wallet and start earning when an AI cites you. Lists current sources.
 */

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
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
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <header className="mb-8 max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/[0.07] px-3 py-1 text-xs font-medium text-amber-700">
            <Sparkles className="h-3 w-3" />
            For creators
          </div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Register your source — get paid when an AI cites you.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Add your feed once. Every time Keryx&apos;s agent reads and cites
            your work to answer a question, a weighted USDC reward lands in your
            wallet — automatically.
          </p>
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,420px)_1fr]">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <RegisterForm onCreated={loadSources} />
          </div>

          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Registered sources ({sources.length})
            </h2>
            <SourcesList sources={sources} />
          </section>
        </div>
      </main>
    </div>
  );
}
