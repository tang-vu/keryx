"use client";

/**
 * Creator onboarding form. Primary path: paste an RSS URL → one-click register.
 * Optional manual fields (name, description, fetch price). On success surfaces
 * the generated wallet + a celebratory toast.
 */

import { useState } from "react";
import { Loader2, Rss, Wallet, PartyPopper } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
  const [fetchPrice, setFetchPrice] = useState("0.005");
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

  return (
    <Card>
      <CardContent className="space-y-5 p-6">
        <div className="space-y-2">
          <Label htmlFor="rss" className="flex items-center gap-1.5">
            <Rss className="h-3.5 w-3.5 text-amber-600" /> RSS feed URL
          </Label>
          <Input
            id="rss"
            value={rssUrl}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://yourblog.com/feed.xml"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            One click — we read your feed, generate a wallet, and you start
            earning when an AI cites you.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowManual((s) => !s)}
          className="text-xs font-medium text-amber-700 hover:underline"
        >
          {showManual ? "Hide manual setup" : "No feed? Add manually"}
        </button>

        {showManual && (
          <div className="space-y-4 rounded-lg border border-border bg-muted/30 p-4">
            <div className="space-y-2">
              <Label htmlFor="name">Source name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Stablecoin Ledger"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="desc">Description</Label>
              <Input
                id="desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What your source covers…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price">Fetch price (USDC)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.001"
                value={fetchPrice}
                onChange={(e) => setFetchPrice(e.target.value)}
                className="w-32 font-mono"
              />
            </div>
          </div>
        )}

        <Button
          onClick={submit}
          disabled={loading}
          className="w-full gap-2 bg-amber-500 text-amber-950 hover:bg-amber-400"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="h-4 w-4" />
          )}
          {loading ? "Registering…" : "Register & generate wallet"}
        </Button>
      </CardContent>
    </Card>
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
    <Card className="animate-in fade-in zoom-in-95 overflow-hidden duration-300">
      <div className="flex items-center gap-2 border-b border-border bg-emerald-500/[0.08] px-6 py-4">
        <PartyPopper className="h-5 w-5 text-emerald-600" />
        <span className="font-semibold">You&apos;re live, {source.name}</span>
      </div>
      <CardContent className="space-y-4 p-6">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Your payout wallet
          </p>
          <p className="mt-1 break-all rounded-lg border border-border bg-muted/40 px-3 py-2 font-mono text-sm text-foreground">
            {source.walletAddress}
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <div>
            <span className="text-muted-foreground">Fetch price </span>
            <span className="font-mono font-semibold">
              ${fmtUsdc(source.fetchPrice)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Authors </span>
            <span className="font-semibold">{source.authors.length}</span>
          </div>
        </div>
        <Button variant="outline" onClick={onAgain} className="w-full">
          Register another source
        </Button>
      </CardContent>
    </Card>
  );
}
