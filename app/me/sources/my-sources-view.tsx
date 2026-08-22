"use client";

/**
 * Management list for every source the signed-in wallet owns: per-source notify state at a
 * glance (alert email, webhook), earnings summary, and a bulk bar that applies one alert email
 * to the whole portfolio in a single click — the thing per-source panels can't do. Fine-grained
 * settings stay on each source's own creator page; every row links there.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BellRing, Loader2, Mail, RefreshCw, Webhook } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { fmtUsdc } from "@/components/keryx/phase-style";

interface OwnedSource {
  id: string;
  name: string;
  active: boolean;
  verified: boolean;
  hasFeed: boolean;
  earnedUsdc: number;
  citationCount: number;
  email: string | null;
  webhookConfigured: boolean;
}

export function MySourcesView() {
  const [loading, setLoading] = useState(true);
  const [signedOut, setSignedOut] = useState(false);
  const [sources, setSources] = useState<OwnedSource[]>([]);
  const [deliveryOn, setDeliveryOn] = useState(true);
  const [bulkEmail, setBulkEmail] = useState("");
  const [applying, setApplying] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  async function load() {
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
      toast.error("Couldn't load your sources — try again.");
    } finally {
      setLoading(false);
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
      if (!res.ok) throw new Error(d.error ?? "Failed to apply");
      toast.success(
        email
          ? `Email alerts on for all ${d.sourceCount} source(s).`
          : `Email alerts off for all ${d.sourceCount} source(s).`,
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to apply");
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
      if (!res.ok) throw new Error(d.message ?? d.error ?? "Refresh failed");
      toast.success(
        d.added
          ? `${s.name}: ${d.added} new post(s) now purchasable.`
          : `${s.name}: feed checked — already up to date.`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshingId(null);
    }
  };

  if (loading)
    return <p className="font-mono text-xs text-ink-3">Loading your sources…</p>;

  if (signedOut)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          Sign in with the wallet that owns your sources to manage them.
        </p>
        <Link href="/connect" className="font-mono text-xs text-seal underline underline-offset-2">
          Connect wallet →
        </Link>
      </div>
    );

  if (sources.length === 0)
    return (
      <div className="rounded border border-dashed border-line p-8 text-center">
        <p className="mb-2 font-serif text-sm text-ink-2">
          This wallet doesn&apos;t own any sources yet.
        </p>
        <Link href="/register" className="font-mono text-xs text-seal underline underline-offset-2">
          List your feed — issue a toll →
        </Link>
      </div>
    );

  return (
    <div className="flex flex-col gap-6">
      {/* Bulk email bar */}
      <section className="border border-line bg-paper p-5">
        <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          <BellRing className="h-3.5 w-3.5 text-seal" /> Citation email alerts — whole portfolio
        </h2>
        <p className="mb-4 max-w-2xl font-serif text-[13px] text-ink-2">
          One address, every source: get a short email whenever any of your sources is cited and
          paid. At most one mail per source per hour. Per-source tweaks live on each source&apos;s
          page below.
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
              Apply to all {sources.length}
            </button>
            {sources.some((s) => s.email) && (
              <button
                type="button"
                onClick={() => void applyAll("")}
                disabled={applying}
                className="border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:bg-paper-2 hover:text-destructive disabled:opacity-60"
              >
                Disable all
              </button>
            )}
          </div>
        </div>
        {!deliveryOn && (
          <p className="mt-3 font-mono text-[10px] text-ink-3">
            Addresses are saved, but this deployment hasn&apos;t enabled an email provider yet —
            delivery starts the moment it does.
          </p>
        )}
      </section>

      {/* Source rows */}
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
                <span>{fmtUsdc(s.earnedUsdc)} earned</span>
                <span>{s.citationCount} citation(s)</span>
                {!s.active && <span className="text-destructive">deactivated</span>}
                {!s.verified && <span>unverified — off the money path</span>}
              </div>
            </div>
            <span
              title={s.email ? `Email alerts → ${s.email}` : "No email alert"}
              className={`flex items-center gap-1 font-mono text-[10px] ${s.email ? "text-seal" : "text-ink-3"}`}
            >
              <Mail className="h-3 w-3" /> {s.email ?? "—"}
            </span>
            <span
              title={s.webhookConfigured ? "Webhook active" : "No webhook"}
              className={`flex items-center gap-1 font-mono text-[10px] ${s.webhookConfigured ? "text-seal" : "text-ink-3"}`}
            >
              <Webhook className="h-3 w-3" /> {s.webhookConfigured ? "on" : "—"}
            </span>
            {s.hasFeed && s.active && (
              <button
                type="button"
                onClick={() => void refreshFeed(s)}
                disabled={refreshingId !== null}
                title="Re-read the feed and pull in new posts"
                className="flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3 transition-colors hover:bg-paper-2 hover:text-seal disabled:opacity-60"
              >
                <RefreshCw
                  className={`h-3 w-3 ${refreshingId === s.id ? "animate-spin" : ""}`}
                />
                Refresh feed
              </button>
            )}
            <Link
              href={`/creator/${s.id}`}
              className="font-mono text-[11px] text-seal underline underline-offset-2 hover:text-ink"
            >
              Manage →
            </Link>
          </div>
        ))}
      </section>
    </div>
  );
}
