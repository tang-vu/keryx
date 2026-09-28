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
import {
  RegisterForm,
  type RegisterPrefill,
} from "@/components/keryx/register-form";
import { BulkImportForm } from "@/components/keryx/bulk-import-form";
import { ClaimOnchainPanel } from "@/components/keryx/claim-onchain-panel";
import { FaucetPanel } from "@/components/keryx/faucet-panel";
import { WithdrawEarningsPanel } from "@/components/keryx/withdraw-earnings-panel";
import {
  SourcesList,
  type SourceCardData,
} from "@/components/keryx/sources-list";
import type { Session } from "@/lib/auth";

export default function RegisterPage() {
  const { address, isConnected } = useAccount();
  const [sources, setSources] = useState<SourceCardData[]>([]);
  const [sourcesState, setSourcesState] = useState<"loading" | "ready" | "error">("loading");
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = loading
  // Pre-fill for claiming a pre-registry source on-chain. The form applies initial values on
  // mount only, so bump the key to re-initialise it with each claim.
  const [prefill, setPrefill] = useState<RegisterPrefill | null>(null);
  const [formKey, setFormKey] = useState(0);
  // Single source at a time, or a pasted batch of feeds. Claiming a pre-registry source pre-fills
  // the single form, so a claim always snaps back to that tab.
  const [mode, setMode] = useState<"single" | "bulk">("single");
  const [draftFeed, setDraftFeed] = useState("");
  const [feedError, setFeedError] = useState("");

  const prepareFeed = () => {
    try {
      const parsed = new URL(draftFeed.trim());
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) throw new Error("Invalid feed URL");
      setPrefill({ rssUrl: parsed.toString() });
      setFormKey((key) => key + 1);
      setMode("single");
      setFeedError("");
    } catch {
      setFeedError("Enter a full http or https RSS feed URL.");
    }
  };

  // Deep-link prefill: ?url= / ?name= / ?desc= seed the manual fields (the browser extension's
  // "list this page as a paid source"), ?rss= seeds the feed field (the demand board's feed check,
  // which arrives having already read that feed). Parsed from window.location on mount
  // (client-only) so the page needs no Suspense boundary for useSearchParams.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      const url = params.get("url")?.trim();
      const name = params.get("name")?.trim();
      const description = params.get("desc")?.trim();
      const rssUrl = params.get("rss")?.trim();
      const gapId = params.get("gap")?.trim();
      const matchedItemLink = params.get("post")?.trim();
      if (!url && !name && !rssUrl) return;
      setPrefill({
        ...(url ? { url } : {}),
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(rssUrl ? { rssUrl } : {}),
        ...(gapId && matchedItemLink ? { gapId, matchedItemLink } : {}),
      });
      setFormKey((k) => k + 1);
      setMode("single");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

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
      if (!res.ok) throw new Error("Sources unavailable");
      const data = (await res.json()) as { sources: SourceCardData[] };
      if (!Array.isArray(data.sources)) throw new Error("Invalid sources response");
      setSources(data.sources ?? []);
      setSourcesState("ready");
    } catch {
      setSourcesState("error");
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
            List an RSS feed you control to offer articles to Keryx. Set a price per read,
            prove feed ownership, and receive Arc testnet USDC when a paid read or citation settles.
          </p>
          <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-ink-2">
            An agent may skip a source after reading its public preview. A paid read and a cited answer
            are separate payment events. Track sources and earnings in <Link href="/me/sources" className="underline">My sources</Link> or inspect public settlements in <Link href="/dashboard" className="underline">Payments & proof</Link>.
          </p>
        </header>

        <section className="mb-8 max-w-2xl border border-ink bg-paper-2 p-5" aria-labelledby="feed-first-title">
          <h2 id="feed-first-title" className="font-display text-xl text-ink">Start with your feed URL</h2>
          <p className="mt-1 text-sm text-ink-2">Check the URL format and carry it into registration. Keryx reads the feed after you sign in; this step does not fetch or verify its contents.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input type="url" value={draftFeed} onChange={(event) => setDraftFeed(event.target.value)} placeholder="https://your-site.example/feed.xml" aria-label="Your RSS feed URL" className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 font-mono text-sm text-ink" />
            <button type="button" onClick={prepareFeed} className="min-h-11 border border-ink bg-ink px-4 font-mono text-xs text-paper">Prepare feed</button>
          </div>
          {feedError && <p role="alert" className="mt-2 text-sm text-seal">{feedError}</p>}
          {prefill?.rssUrl && !feedError && <p className="mt-2 break-all text-sm text-ink-2">Ready to register: {prefill.rssUrl}. Connect your wallet below to continue.</p>}
        </section>

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
                {/* Returning creators: pull accrued citation earnings on-chain (gasless). */}
                {address && <WithdrawEarningsPanel address={address} />}
                {/* Sources this wallet listed before the registry existed — one click pre-fills
                    the form below with the source's own feed/URL and price to claim it on-chain. */}
                <ClaimOnchainPanel
                  sources={sources}
                  address={address}
                  onClaim={(s) => {
                    setPrefill({
                      rssUrl: s.rssUrl,
                      // Without a feed the claim goes through the manual fields instead.
                      ...(s.rssUrl
                        ? {}
                        : { name: s.name, url: s.url, description: s.description }),
                      fetchPrice: s.fetchPrice,
                    });
                    setFormKey((k) => k + 1);
                    setMode("single"); // a claim pre-fills the single form
                  }}
                />
                {/* Registering writes the source to the on-chain registry from the creator's own
                    wallet, so it costs gas. A wallet arriving here empty would dead-end at the
                    signature prompt; the drip is one click and one claim per address. */}
                <div className="mb-4">
                  <FaucetPanel />
                </div>
                {/* One source at a time, or paste a whole list of feeds at once. */}
                <div className="mb-4 flex gap-1 border border-line bg-paper-2 p-1">
                  {(["single", "bulk"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`flex-1 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors ${
                        mode === m
                          ? "bg-ink text-cream"
                          : "text-ink-3 hover:text-ink"
                      }`}
                    >
                      {m === "single" ? "One source" : "Bulk import"}
                    </button>
                  ))}
                </div>
                {mode === "single" ? (
                  <RegisterForm
                    key={formKey}
                    onCreated={loadSources}
                    prefillWalletAddress={address}
                    prefill={prefill ?? undefined}
                  />
                ) : (
                  <BulkImportForm onRegistered={loadSources} />
                )}
              </>
            )}
          </div>

          <section>
            <h2 className="mb-4 font-mono text-[12px] uppercase tracking-[0.16em] text-ink-3">Registered sources</h2>
            {sourcesState === "loading" && <p role="status" className="text-sm text-ink-3">Loading registered sources…</p>}
            {sourcesState === "error" && <p role="status" className="text-sm text-ink-3">Registered sources are unavailable right now. <button type="button" onClick={() => { setSourcesState("loading"); void loadSources(); }} className="underline">Retry</button></p>}
            {sourcesState === "ready" && <SourcesList sources={sources} />}
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
