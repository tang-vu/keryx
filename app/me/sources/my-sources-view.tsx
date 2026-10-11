"use client";

/**
 * Management list for every source the signed-in wallet owns: per-source notify state at a
 * glance (alert email, webhook), earnings summary, and a bulk bar that applies one alert email
 * to the whole portfolio in a single click — the thing per-source panels can't do. Fine-grained
 * settings stay on each source's own creator page; every row links there.
 */

import { createMessages } from "@/lib/i18n/messages";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2, Mail, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { FeedVerificationPanel, type VerificationSource } from "@/components/keryx/feed-verification-panel";
import { fmtUsdc } from "@/components/keryx/phase-style";

const uiCopy = createMessages("en");

interface OwnedSource {
  id: string;
  name: string;
  active: boolean;
  verified: boolean;
  hasFeed: boolean;
  verificationSource?: VerificationSource | null;
  earnedUsdc: number;
  citationCount: number;
  email: string | null;
  webhookConfigured: boolean;
}

interface CreatorListing {
  id: string;
  name: string;
  active: boolean;
}

export function MySourcesView() {
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [sources, setSources] = useState<OwnedSource[]>([]);
  const [listings, setListings] = useState<CreatorListing[]>([]);
  const [listingError, setListingError] = useState(false);
  const [listingCursor, setListingCursor] = useState<string | null>(null);
  const [listingUncertain, setListingUncertain] = useState(0);
  const [loadingMoreListings, setLoadingMoreListings] = useState(false);
  const [deliveryOn, setDeliveryOn] = useState(true);
  const [bulkEmail, setBulkEmail] = useState("");
  const [applying, setApplying] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  async function load() {
    setListings([]);
    setListingCursor(null);
    setListingUncertain(0);
    try {
      const res = await fetch("/api/me/sources", { cache: "no-store" });
      if (res.status === 401) {
        setSignedOut(true);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as { emailEnabled: boolean; sources: OwnedSource[] };
      setSources(d.sources);
      setDeliveryOn(d.emailEnabled);
      // Prefill the bulk field when the whole portfolio already shares one address.
      const emails = [...new Set(d.sources.map((s) => s.email).filter(Boolean))];
      if (emails.length === 1) setBulkEmail(emails[0] as string);
    } catch {
      toast.error(uiCopy("creatorPortfolio.loadFailed"));
    } finally {
      try {
        const res = await fetch("/api/me/listings", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          listings: CreatorListing[]; nextCursor: string | null; uncertain: number;
        };
        setListings(data.listings);
        setListingCursor(data.nextCursor);
        setListingUncertain(data.uncertain);
        setListingError(false);
      } catch {
        setListingError(true);
      }
      setLoading(false);
    }
  }

  async function loadMoreListings() {
    if (!listingCursor || loadingMoreListings) return;
    setLoadingMoreListings(true);
    try {
      const res = await fetch(`/api/me/listings?cursor=${encodeURIComponent(listingCursor)}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        listings: CreatorListing[]; nextCursor: string | null; uncertain: number;
      };
      setListings((previous) => [
        ...previous,
        ...data.listings.filter((listing) => !previous.some((row) => row.id === listing.id)),
      ]);
      setListingCursor(data.nextCursor);
      setListingUncertain((previous) => previous + data.uncertain);
      setListingError(false);
    } catch {
      setListingError(true);
    } finally {
      setLoadingMoreListings(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const applyAll = async (email: string) => {
    if (applying) return;
    setApplying(true);
    try {
      const res = await fetch("/api/me/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = (await res.json()) as { sourceCount?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? uiCopy("creatorPortfolio.applyFailed"));
      toast.success(
        email
          ? uiCopy(d.sourceCount === 1 ? "creatorPortfolio.emailEnabled.one" : "creatorPortfolio.emailEnabled.other", { count: String(d.sourceCount) })
          : uiCopy(d.sourceCount === 1 ? "creatorPortfolio.emailDisabled.one" : "creatorPortfolio.emailDisabled.other", { count: String(d.sourceCount) }),
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : uiCopy("creatorPortfolio.applyFailed"));
    } finally {
      setApplying(false);
    }
  };

  /** Pull in posts published since the last ingest — new items become purchasable immediately. */
  const refreshFeed = async (s: OwnedSource) => {
    if (refreshingId) return;
    setRefreshingId(s.id);
    try {
      const res = await fetch(`/api/me/sources/${encodeURIComponent(s.id)}/refresh`, {
        method: "POST",
      });
      const d = (await res.json()) as { added?: number; error?: string; message?: string };
      if (!res.ok) throw new Error(d.message ?? d.error ?? uiCopy("creatorPortfolio.refreshFailed"));
      toast.success(
        d.added
          ? uiCopy(d.added === 1 ? "creatorPortfolio.newPosts.one" : "creatorPortfolio.newPosts.other", { name: s.name, count: d.added })
          : uiCopy("creatorPortfolio.upToDate", { name: s.name }),
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : uiCopy("creatorPortfolio.refreshFailed"));
    } finally {
      setRefreshingId(null);
    }
  };

  if (loading)
    return <p className="font-mono text-xs text-ink-3">{uiCopy("creatorPortfolio.loading")}</p>;

  if (signedOut)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          {uiCopy("creatorPortfolio.signIn")}
        </p>
        <Link href="/connect" className="font-mono text-xs text-seal underline underline-offset-2">
          {uiCopy("creatorPortfolio.connect")}
        </Link>
      </div>
    );

  if (sources.length === 0 && listings.length === 0 && !listingError && !listingCursor && listingUncertain === 0)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          {uiCopy("creatorPortfolio.empty")}
        </p>
        <Link href="/register" className="font-mono text-xs text-seal underline underline-offset-2">
          {uiCopy("creatorPortfolio.register")}
        </Link>
      </div>
    );

  const listingOnly = listings.filter((listing) => !sources.some((source) => source.id === listing.id));

  return (
    <div className="flex flex-col gap-6">
      {(listingOnly.length > 0 || listingError || listingCursor || listingUncertain > 0) && (
        <section className="border border-line bg-paper p-5">
          <h2 className="mb-2 font-serif text-lg text-ink">{uiCopy("creatorPortfolio.listings")}</h2>
          <p className="mb-4 font-serif text-[13px] text-ink-2">
            {uiCopy("creatorPortfolio.listingOwnership")}
          </p>
          {listingOnly.length > 0 && (
            <div className="divide-y divide-line border border-line">
              {listingOnly.map((listing) => (
                <div key={listing.id} className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="font-serif text-sm text-ink">
                    {listing.name}{!listing.active && <span className="ml-2 font-mono text-[10px] text-destructive">{uiCopy("creatorPortfolio.deactivated")}</span>}
                  </span>
                  <Link href={`/creator/${listing.id}`} className="font-mono text-[11px] text-seal underline underline-offset-2">
                    {uiCopy("creatorPortfolio.manageListing")}
                  </Link>
                </div>
              ))}
            </div>
          )}
          {listingUncertain > 0 && (
            <p className="mt-3 font-mono text-xs text-ink-3">
              {uiCopy(listingUncertain === 1 ? "creatorPortfolio.uncertain.one" : "creatorPortfolio.uncertain.other", { count: listingUncertain })}
            </p>
          )}
          {listingError && (
            <p className="mt-3 font-mono text-xs text-destructive">{uiCopy("creatorPortfolio.listingFailed")}</p>
          )}
          {listingCursor && (
            <button type="button" onClick={() => void loadMoreListings()} disabled={loadingMoreListings}
              className="mt-4 border border-line px-3 py-2 font-mono text-[11px] text-seal disabled:opacity-60">
              {loadingMoreListings ? uiCopy("creatorPortfolio.checking") : uiCopy("creatorPortfolio.more")}
            </button>
          )}
        </section>
      )}
      {/* Bulk email bar */}
      {sources.length > 0 && (
      <section className="border border-line bg-paper p-5">
        <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          <BellRing className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorPortfolio.emailTitle")}
        </h2>
        <p className="mb-4 max-w-2xl font-serif text-[13px] text-ink-2">
          {uiCopy("creatorPortfolio.emailDescription")}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            type="email"
            value={bulkEmail}
            onChange={(e) => setBulkEmail(e.target.value)}
            placeholder="you@example.com"
            className="max-w-sm bg-paper-2 font-mono text-sm"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void applyAll(bulkEmail.trim())}
              disabled={applying || !bulkEmail.trim()}
              className="flex items-center justify-center gap-2 border border-ink bg-seal px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              {uiCopy(sources.length === 1 ? "creatorPortfolio.applyAll.one" : "creatorPortfolio.applyAll.other", { count: sources.length })}
            </button>
            {sources.some((s) => s.email) && (
              <button
                type="button"
                onClick={() => void applyAll("")}
                disabled={applying}
                className="border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:bg-paper-2 hover:text-destructive disabled:opacity-60"
              >
                {uiCopy("creatorPortfolio.disableAll")}
              </button>
            )}
          </div>
        </div>
        {!deliveryOn && (
          <p className="mt-3 font-mono text-[10px] text-ink-3">
            {uiCopy("creatorPortfolio.deliveryHeld")}
          </p>
        )}
      </section>

      )}
      {/* Source rows */}
      {sources.length > 0 && (
      <section className="divide-y divide-line border border-line bg-paper">
        {sources.map((s) => (
          <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4">
            <div className="min-w-0 flex-1">
              <Link
                href={`/creator/${s.id}`}
                className="font-serif text-[15px] text-ink underline-offset-2 hover:underline"
              >
                {s.name}
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
                <span>{uiCopy("creatorPortfolio.earned", { amount: fmtUsdc(s.earnedUsdc) })}</span>
                <span>{uiCopy(s.citationCount === 1 ? "creatorPortfolio.citations.one" : "creatorPortfolio.citations.other", { count: s.citationCount })}</span>
                {!s.active && <span className="text-destructive">{uiCopy("creatorPortfolio.deactivated")}</span>}
                {!s.verified && <span>{uiCopy("creatorPortfolio.unverified")}</span>}
              </div>
            </div>
            <span
              title={s.email ? uiCopy("creatorPortfolio.emailTitleWithAddress", { email: s.email }) : uiCopy("creatorPortfolio.noEmail")}
              className={`flex items-center gap-1 font-mono text-[10px] ${s.email ? "text-seal" : "text-ink-3"}`}
            >
              <Mail className="h-3 w-3" /> {s.email ?? "—"}
            </span>
            <span
              title={s.webhookConfigured ? uiCopy("creatorPortfolio.webhookActive") : uiCopy("creatorPortfolio.noWebhook")}
              className={`flex items-center gap-1 font-mono text-[10px] ${s.webhookConfigured ? "text-seal" : "text-ink-3"}`}
            >
              <Webhook className="h-3 w-3" /> {s.webhookConfigured ? uiCopy("creatorPortfolio.webhookOn") : "—"}
            </span>
            {s.hasFeed && s.active && (
              <button
                type="button"
                onClick={() => void refreshFeed(s)}
                disabled={refreshingId !== null}
                title={uiCopy("creatorPortfolio.refreshTitle")}
                className="flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:bg-paper-2 hover:text-seal disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshingId === s.id ? "animate-spin" : ""}`}
                />
                {uiCopy("creatorPortfolio.refresh")}
              </button>
            )}
            <Link
              href={`/creator/${s.id}`}
              className="font-mono text-[11px] text-seal underline underline-offset-2 hover:text-ink"
            >
              {uiCopy("creatorPortfolio.manage")}
            </Link>
            {!s.verified && s.verificationSource && <div className="w-full pt-3"><FeedVerificationPanel key={`${s.id}:${s.verificationSource.walletAddress}`} source={s.verificationSource} onVerified={() => { setSources((previous) => previous.map((row) => row.id === s.id ? { ...row, verified: true } : row)); }} /></div>}
          </div>
        ))}
      </section>
      )}
    </div>
  );
}
