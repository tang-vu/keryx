"use client";

/**
 * Bulk import — paste many RSS feed URLs (or an OPML file) and register them all in one pass.
 *
 * Flow:
 *   1. POST /api/sources/bulk → server reads every feed once, returns per-feed register params.
 *   2. Client fires registry.register() sequentially — one wallet signature per ready feed. The
 *      contract has no batch register, so N sources = N signatures; this just does the one shared
 *      feed-read + dedupe so the creator pastes a list instead of re-typing each URL.
 *   3. All the creator's feeds share ONE ownership token → a single Verify-all pass covers them.
 *
 * Offline dev (registry unset): the bulk POST writes rows directly, so feeds land "done" with no tx.
 */

import { useMemo, useState } from "react";
import { Loader2, Wallet, Upload, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { useWriteContract, usePublicClient } from "wagmi";
import { fmtUsdc } from "./phase-style";
import { REGISTRY_ABI } from "@/lib/registry/registry-client";
import { parseFeedList, MAX_BULK_FEEDS } from "@/lib/ingest/feed-list";
import {
  BulkImportResults,
  BulkVerifyPanel,
  type BulkFeed,
  type BulkPhase,
} from "./bulk-import-results";

interface OnchainRegisterParams {
  urlHash: `0x${string}`;
  payoutWallet: `0x${string}`;
  authors: { wallet: `0x${string}`; basisPoints: number }[];
  fetchPriceUsdc6: string;
  contentCid: string;
  tags: string;
}

type PreparedFeed = BulkFeed & {
  registryAddress?: `0x${string}`;
  registerParams?: OnchainRegisterParams;
  verification?: { token: string; canVerify: boolean; instructions: string } | null;
};

export function BulkImportForm({ onRegistered }: { onRegistered?: () => void }) {
  const [input, setInput] = useState("");
  const [price, setPrice] = useState("0.016");
  const [preparing, setPreparing] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifiedCount, setVerifiedCount] = useState(0);
  const [feeds, setFeeds] = useState<PreparedFeed[]>([]);

  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();

  const patch = (rssUrl: string, next: Partial<PreparedFeed>) =>
    setFeeds((fs) => fs.map((f) => (f.rssUrl === rssUrl ? { ...f, ...next } : f)));

  const toggle = (rssUrl: string) =>
    setFeeds((fs) => fs.map((f) => (f.rssUrl === rssUrl ? { ...f, selected: !f.selected } : f)));

  const readFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setInput((prev) => (prev.trim() ? `${prev}\n${text}` : text));
    e.target.value = ""; // let the same file be picked again
  };

  const prepare = async () => {
    const urls = parseFeedList(input);
    if (urls.length === 0) {
      toast.error("Paste at least one feed URL, or load an OPML file.");
      return;
    }
    setPreparing(true);
    setVerifiedCount(0);
    try {
      const res = await fetch("/api/sources/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeds: urls, fetchPrice: parseFloat(price) || undefined }),
      });
      const data = (await res.json()) as { results?: PreparedFeed[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const prepared = (data.results ?? []).map<PreparedFeed>((r) => ({
        ...r,
        // On-chain returns the id at the top level; the offline DB-direct path nests it under
        // `source`. Normalise so Verify-all can key on `sourceId` either way.
        sourceId: r.sourceId ?? (r as { source?: { id?: string } }).source?.id,
        selected: Boolean(r.ok),
        phase: (r.ok ? (r.mode === "offline" ? "done" : "ready") : "failed") as BulkPhase,
      }));
      setFeeds(prepared);
      const ok = prepared.filter((f) => f.ok).length;
      toast.success(`${ok} of ${prepared.length} feeds ready.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      setPreparing(false);
    }
  };

  const registerSelected = async () => {
    const targets = feeds.filter(
      (f) => f.selected && f.ok && f.phase === "ready" && f.mode === "onchain" && f.registerParams,
    );
    if (targets.length === 0) {
      toast.error("Nothing ready to register — select at least one ingested feed.");
      return;
    }
    setRegistering(true);
    for (const f of targets) {
      patch(f.rssUrl, { phase: "signing" });
      try {
        const p = f.registerParams!;
        const hash = await writeContractAsync({
          address: f.registryAddress!,
          abi: REGISTRY_ABI,
          functionName: "register",
          args: [p.urlHash, p.payoutWallet, p.authors, BigInt(p.fetchPriceUsdc6), p.contentCid, p.tags],
        });
        patch(f.rssUrl, { phase: "confirming", txHash: hash });
        if (publicClient) await publicClient.waitForTransactionReceipt({ hash });
        patch(f.rssUrl, { phase: "done" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Signature rejected";
        patch(f.rssUrl, { phase: "failed", error: msg.slice(0, 120) });
      }
    }
    setRegistering(false);
    onRegistered?.();
    setTimeout(() => onRegistered?.(), 5_000); // indexer lag ≤4s
  };

  const verifyAll = async () => {
    const done = feeds.filter((f) => f.phase === "done" && f.sourceId);
    if (done.length === 0) return;
    setVerifying(true);
    let verified = 0;
    for (const f of done) {
      try {
        const res = await fetch("/api/sources/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceId: f.sourceId }),
        });
        const data = (await res.json()) as { verified?: boolean };
        if (res.ok && data.verified) verified++;
      } catch {
        /* keep going — one feed missing its token must not stop the rest */
      }
    }
    setVerifiedCount(verified);
    setVerifying(false);
    toast[verified === done.length ? "success" : "message"](
      `${verified} of ${done.length} feeds verified.`,
      { description: verified < done.length ? "Add the token to the rest, then check again." : undefined },
    );
    onRegistered?.();
  };

  const priceNum = parseFloat(price) || 0;
  const pendingOnchain = feeds.filter((f) => f.phase === "ready").length;
  const doneCount = feeds.filter((f) => f.phase === "done").length;
  const verifyToken = useMemo(() => feeds.find((f) => f.verification?.token)?.verification, [feeds]);
  const busy = preparing || registering || verifying;

  return (
    <div className="space-y-6 border border-ink bg-paper p-7">
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
          <ListPlus className="h-3.5 w-3.5 text-seal" /> Feed URLs or OPML
        </label>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={6}
          placeholder={"https://blog-one.com/feed.xml\nhttps://blog-two.com/rss\n…or paste an OPML export"}
          className="w-full resize-y rounded-md border border-line bg-paper-2 px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-ink"
        />
        <div className="flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-seal hover:underline">
            <Upload className="h-3.5 w-3.5" /> Load OPML file
            <input type="file" accept=".opml,.xml,text/xml,text/plain" onChange={readFile} className="hidden" />
          </label>
          <span className="font-mono text-[10.5px] text-ink-3">up to {MAX_BULK_FEEDS} feeds per import</span>
        </div>
      </div>

      {/* One price applies to every feed in the batch; each can be re-tuned later from its profile. */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <label className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Price per read (all feeds)
          </label>
          <span className="font-display text-[22px] font-bold tabular-nums text-seal">
            ${fmtUsdc(priceNum)}
          </span>
        </div>
        <input
          type="range"
          min={0.005}
          max={0.04}
          step={0.001}
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-full cursor-pointer"
        />
      </div>

      <button
        type="button"
        onClick={prepare}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-paper-2 px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
        {preparing ? "Reading feeds…" : "Read feeds ▸"}
      </button>

      <BulkImportResults feeds={feeds} onToggle={toggle} busy={busy} />

      {pendingOnchain > 0 && (
        <button
          type="button"
          onClick={registerSelected}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {registering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
          {registering
            ? "Signing on-chain…"
            : `Register ${feeds.filter((f) => f.selected && f.phase === "ready").length} on-chain ▸`}
        </button>
      )}

      {doneCount > 0 && verifyToken && (
        <BulkVerifyPanel
          token={verifyToken.token}
          instructions={verifyToken.instructions}
          registeredCount={doneCount}
          verifiedCount={verifiedCount}
          verifying={verifying}
          onVerifyAll={verifyAll}
        />
      )}
    </div>
  );
}
