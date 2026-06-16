"use client";

/**
 * Creator onboarding form. Primary path: paste an RSS URL → one-click register.
 * Optional manual fields (name, description, price-per-read dial). On success
 * surfaces the generated wallet + a celebratory toast. Styled as a banknote
 * registration slip.
 */

import { useState } from "react";
import { Loader2, Rss, Wallet, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtUsdc } from "./phase-style";

interface CreatedSource {
  id: string;
  name: string;
  walletAddress: string;
  fetchPrice: number;
  authors: { name: string; splitWeight: number }[];
}

export function RegisterForm({ onCreated }: { onCreated?: () => void }) {
  const [rssUrl, setRssUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fetchPrice, setFetchPrice] = useState("0.016");
  const [showManual, setShowManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedSource | null>(null);

  const submit = async () => {
    if (loading) return;
    const body = rssUrl.trim()
      ? { rssUrl: rssUrl.trim() }
      : {
          name: name.trim(),
          description: description.trim(),
          fetchPrice: parseFloat(fetchPrice) || undefined,
        };
    if (!("rssUrl" in body) && !body.name) {
      toast.error("Add an RSS URL or a source name.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Registration failed");
      setCreated(data.source as CreatedSource);
      toast.success(`${data.source.name} is registered — ready to earn.`, {
        description: "A wallet was generated. You earn on every citation.",
      });
      setRssUrl("");
      setName("");
      setDescription("");
      onCreated?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return <SuccessCard source={created} onAgain={() => setCreated(null)} />;
  }

  const price = parseFloat(fetchPrice) || 0;

  return (
    <div className="rounded-lg border border-line bg-card p-7">
      <div className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="rss" className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            <Rss className="h-3.5 w-3.5 text-seal" /> RSS feed URL
          </Label>
          <Input
            id="rss"
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://yourblog.com/feed.xml"
            className="bg-paper-2 font-mono text-sm"
          />
          <p className="text-xs text-ink-2">
            One click — we read your feed, generate a wallet, and you start
            earning when an AI cites you.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowManual((s) => !s)}
          className="font-mono text-[11px] uppercase tracking-[0.08em] text-seal hover:underline"
        >
          {showManual ? "Hide manual setup" : "No feed? Add manually"}
        </button>

        {showManual && (
          <div className="space-y-5 rounded-md border border-line-2 bg-paper-2 p-4">
            <div className="space-y-2">
              <Label htmlFor="name" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                Source name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stablecoin Ledger"
                className="bg-card font-serif text-[16px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                Description
              </Label>
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What your source covers…"
                className="bg-card"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="price" className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
                  Price per read
                </Label>
                <span className="font-mono text-[18px] tabular-nums text-seal">
                  ${fmtUsdc(price)}
                </span>
              </div>
              <input
                id="price"
                type="range"
                min={0.005}
                max={0.04}
                step={0.001}
                value={fetchPrice}
                onChange={(e) => setFetchPrice(e.target.value)}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10.5px] text-ink-3">
                <span>$0.005</span>
                <span>$0.040</span>
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-seal px-4 py-3.5 text-[15px] font-semibold text-cream shadow-[0_10px_22px_-12px_rgba(197,64,42,0.7)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="h-4 w-4" />
          )}
          {loading ? "Registering…" : "Publish source →"}
        </button>
      </div>
    </div>
  );
}

function SuccessCard({
  source,
  onAgain,
}: {
  source: CreatedSource;
  onAgain: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-card animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-2 border-b border-line-2 bg-paid/[0.08] px-6 py-4">
        <PartyPopper className="h-5 w-5 text-paid" />
        <span className="font-serif text-lg text-ink">
          You&apos;re live, {source.name}
        </span>
      </div>
      <div className="space-y-4 p-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Your payout wallet
          </p>
          <p className="mt-1.5 break-all rounded-md border border-line bg-paper-2 px-3 py-2 font-mono text-sm text-ink">
            {source.walletAddress}
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-ink-3">Fetch price </span>
            <span className="font-mono font-semibold text-ink">
              ${fmtUsdc(source.fetchPrice)}
            </span>
          </div>
          <div>
            <span className="text-ink-3">Authors </span>
            <span className="font-semibold text-ink">{source.authors.length}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onAgain}
          className="w-full rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-2"
        >
          Register another source
        </button>
      </div>
    </div>
  );
}
