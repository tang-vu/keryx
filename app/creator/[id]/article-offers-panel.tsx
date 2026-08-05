"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeDollarSign, Loader2, ShieldCheck, TimerReset, X } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useSignTypedData } from "wagmi";

import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { articleOfferTypedData } from "@/lib/offers/article-offer";

interface OfferRow {
  id: string;
  priceUsdc: number;
  expiresAt: number;
  expiresAtIso: string;
}

interface OfferItem {
  itemId: string;
  itemTitle: string;
  itemUrl: string;
  contentVersion: string;
  itemPublishedAt?: string;
  offer: OfferRow | null;
}

interface OfferData {
  sourceId: string;
  sourceName: string;
  creator: `0x${string}`;
  active: boolean;
  verified: boolean;
  listPriceUsdc: number;
  minPriceUsdc: number;
  items: OfferItem[];
}

function nonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

export function ArticleOffersPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<OfferData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [working, setWorking] = useState<string | null>(null);
  const [ttlHours, setTtlHours] = useState(72);
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/creator/${creatorId}/offers`, { cache: "no-store" });
      if (!response.ok) return;
      const next = (await response.json()) as OfferData;
      setData(next);
      setDrafts((current) => {
        const seeded = { ...current };
        for (const item of next.items) {
          seeded[item.itemId] ??= String(
            item.offer?.priceUsdc ?? Math.max(next.minPriceUsdc, next.listPriceUsdc / 2),
          );
        }
        return seeded;
      });
    } catch {
      // Owner-only enhancement: a failed probe must not break the public creator profile.
    }
  }, [creatorId]);

  useEffect(() => {
    // `load` reaches its first state update only after the fetch promise resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!data || data.items.length === 0) return null;

  const wrongWallet =
    !!address && address.toLowerCase() !== data.creator.toLowerCase();

  const publish = async (item: OfferItem) => {
    const priceUsdc6 = Math.round(Number(drafts[item.itemId]) * 1_000_000);
    if (!address || wrongWallet) {
      toast.error(`Connect the creator wallet ${shortAddr(data.creator)}.`);
      return;
    }
    if (!Number.isSafeInteger(priceUsdc6) || priceUsdc6 < Math.round(data.minPriceUsdc * 1_000_000)) {
      toast.error(`Minimum offer is $${fmtUsdc(data.minPriceUsdc)}.`);
      return;
    }
    if (priceUsdc6 > Math.round(data.listPriceUsdc * 1_000_000)) {
      toast.error("An article offer cannot exceed the registry list price.");
      return;
    }

    setWorking(item.itemId);
    try {
      const expiresAt = Math.floor(Date.now() / 1_000) + ttlHours * 60 * 60;
      const offerNonce = nonce();
      const signature = await signTypedDataAsync(
        articleOfferTypedData({
          sourceId: data.sourceId,
          itemId: item.itemId,
          contentVersion: item.contentVersion,
          priceUsdc6,
          expiresAt,
          nonce: offerNonce,
        }),
      );
      const response = await fetch(`/api/creator/${creatorId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemId: item.itemId,
          contentVersion: item.contentVersion,
          priceUsdc6,
          expiresAt,
          nonce: offerNonce,
          signature,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not publish offer");
      toast.success("Signed article offer is live in the market.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not publish offer");
    } finally {
      setWorking(null);
    }
  };

  const revoke = async (item: OfferItem) => {
    setWorking(item.itemId);
    try {
      const response = await fetch(`/api/creator/${creatorId}/offers`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.itemId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not revoke offer");
      toast.success("Article offer revoked; list price applies again.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke offer");
    } finally {
      setWorking(null);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          <BadgeDollarSign className="h-3.5 w-3.5 text-seal" /> Article offer desk
        </h2>
        <label className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
          <TimerReset className="h-3.5 w-3.5" /> expires
          <select
            value={ttlHours}
            onChange={(event) => setTtlHours(Number(event.target.value))}
            className="border border-line bg-paper-2 px-2 py-1 text-ink"
          >
            <option value={24}>24 hours</option>
            <option value={72}>3 days</option>
            <option value={168}>7 days</option>
            <option value={720}>30 days</option>
          </select>
        </label>
      </div>
      <p className="mb-4 max-w-2xl font-serif text-[13px] text-ink-2">
        Sign a temporary price for one exact article version. The registry&apos;s ${fmtUsdc(data.listPriceUsdc)}
        read price remains the ceiling and payout wallet; the agent verifies this signature again before buying.
      </p>

      {(!data.active || !data.verified) && (
        <p className="mb-4 border border-amber-300 bg-amber-50 p-3 font-mono text-[11px] text-amber-800">
          This source must be active and feed-verified before it can publish offers.
        </p>
      )}

      <div className="divide-y divide-line border-y border-line">
        {data.items.map((item) => {
          const busy = working === item.itemId;
          return (
            <div key={item.itemId} className="grid gap-3 py-3 md:grid-cols-[1fr_150px_auto] md:items-center">
              <div className="min-w-0">
                <a
                  href={item.itemUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate font-serif text-[13px] text-ink hover:text-seal"
                >
                  {item.itemTitle}
                </a>
                <p className="mt-1 font-mono text-[9px] text-ink-3">
                  {item.contentVersion.slice(0, 28)}…
                  {item.offer
                    ? ` · live at $${fmtUsdc(item.offer.priceUsdc)} until ${new Date(item.offer.expiresAtIso).toLocaleString()}`
                    : " · list price"}
                </p>
              </div>
              <label className="flex items-center border border-line bg-paper-2 px-2 py-1.5">
                <span className="mr-1 font-mono text-xs text-ink-3">$</span>
                <input
                  inputMode="decimal"
                  value={drafts[item.itemId] ?? ""}
                  onChange={(event) => setDrafts((current) => ({ ...current, [item.itemId]: event.target.value }))}
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none"
                />
              </label>
              <div className="flex gap-2 md:justify-end">
                {item.offer && (
                  <button
                    type="button"
                    onClick={() => void revoke(item)}
                    disabled={busy}
                    className="border border-line px-2.5 py-2 text-ink-3 hover:border-destructive hover:text-destructive disabled:opacity-50"
                    aria-label={`Revoke offer for ${item.itemTitle}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void publish(item)}
                  disabled={busy || wrongWallet || !data.active || !data.verified}
                  className="flex min-w-28 items-center justify-center gap-1.5 border border-ink bg-seal px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-cream disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Sign offer
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {wrongWallet && (
        <p className="mt-3 font-mono text-[10px] text-amber-700">
          Pricing authority is {shortAddr(data.creator)}. Switch the connected wallet to sign.
        </p>
      )}
    </section>
  );
}
