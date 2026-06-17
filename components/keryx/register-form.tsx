"use client";

/**
 * Creator onboarding form. Primary path: paste an RSS URL → one-click register.
 * Optional manual fields (name, description, price-per-read dial).
 *
 * Two-phase submit when the on-chain registry is configured:
 *   1. POST /api/sources → server returns { mode:"onchain", registerParams, registryAddress }
 *   2. Client calls useWriteContract → registry.register(...) — creator signs + pays gas
 *   3. Indexer picks up SourceRegistered event within ≤4s and writes the DB cache row.
 *
 * When the registry is NOT configured (offline dev), the server returns { mode:"offline" }
 * and the source row is written to DB immediately (same as Phase 01 behaviour).
 *
 * Styled as a banknote registration slip (The Mint aesthetic).
 */

import { useState } from "react";
import { Loader2, Rss, Wallet, PartyPopper, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtUsdc } from "./phase-style";
import { REGISTRY_ABI } from "@/lib/registry/registry-client";

interface CreatedSource {
  id: string;
  name: string;
  walletAddress: string;
  fetchPrice: number;
  authors: { name: string; splitWeight: number }[];
}

interface OnchainRegisterParams {
  urlHash: `0x${string}`; // keccak256(toBytes(canonicalUrl)) — contract derives id on-chain
  payoutWallet: `0x${string}`;
  authors: { wallet: `0x${string}`; basisPoints: number }[];
  fetchPriceUsdc6: string; // BigInt serialised as string (JSON can't carry BigInt)
  contentCid: string;
  tags: string;
}

export function RegisterForm({
  onCreated,
  prefillWalletAddress,
}: {
  onCreated?: () => void;
  /** Connected wallet address pre-filled from SIWE session — sent to the server
   *  so the POST handler can override it with the session-verified address. */
  prefillWalletAddress?: string;
}) {
  const [rssUrl, setRssUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fetchPrice, setFetchPrice] = useState("0.016");
  const [showManual, setShowManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedSource | null>(null);

  // wagmi hooks for the on-chain register call (only used when registry is configured).
  const { writeContractAsync } = useWriteContract();
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: isMining } = useWaitForTransactionReceipt({ hash: pendingTxHash });

  const submit = async () => {
    if (loading || isMining) return;

    const baseBody = prefillWalletAddress ? { walletAddress: prefillWalletAddress } : {};
    const body = rssUrl.trim()
      ? { ...baseBody, rssUrl: rssUrl.trim() }
      : {
          ...baseBody,
          name: name.trim(),
          description: description.trim(),
          fetchPrice: parseFloat(fetchPrice) || undefined,
        };

    if (!("rssUrl" in body) && !("name" in body && body.name)) {
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
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error((data?.error as string) ?? "Registration failed");

      if (data.mode === "onchain") {
        // On-chain path: call registry.register() from the creator's connected wallet.
        // The contract derives the sourceId on-chain as keccak256(abi.encode(msg.sender, urlHash)).
        const params = data.registerParams as OnchainRegisterParams;
        const registryAddress = data.registryAddress as `0x${string}`;
        const returnedSourceId = data.sourceId as string;

        toast.loading("Waiting for wallet signature…", { id: "register-tx" });

        const txHash = await writeContractAsync({
          address: registryAddress,
          abi: REGISTRY_ABI,
          functionName: "register",
          args: [
            params.urlHash,            // bytes32 urlHash — id derived on-chain from msg.sender + urlHash
            params.payoutWallet,
            params.authors,
            BigInt(params.fetchPriceUsdc6),
            params.contentCid,
            params.tags,
          ],
        });

        setPendingTxHash(txHash);
        toast.loading("Transaction submitted — waiting for confirmation…", { id: "register-tx" });

        // Show a pending success card — the indexer will add the DB row within ≤4s.
        toast.success("Source registered on-chain!", {
          id: "register-tx",
          description: "Your source will appear in the list within a few seconds.",
        });

        setCreated({
          id: returnedSourceId,
          name: ("name" in body && typeof body.name === "string" ? body.name : undefined)
            || ("rssUrl" in body && typeof body.rssUrl === "string" ? body.rssUrl : returnedSourceId),
          walletAddress: params.payoutWallet,
          fetchPrice: parseFloat(fetchPrice) || 0,
          authors: params.authors.map((a) => ({
            name: a.wallet,
            splitWeight: a.basisPoints / 10_000,
          })),
        });

        setRssUrl("");
        setName("");
        setDescription("");
        onCreated?.();
        // Trigger a reload after indexer lag (≤4s).
        setTimeout(() => onCreated?.(), 5_000);
      } else {
        // Offline / DB-direct path — source written immediately.
        const source = data.source as CreatedSource;
        setCreated(source);
        toast.success(`${source.name} is registered — ready to earn.`, {
          description: "Your source is live in the registry.",
        });
        setRssUrl("");
        setName("");
        setDescription("");
        onCreated?.();
      }
    } catch (err) {
      toast.dismiss("register-tx");
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (created) {
    return (
      <SuccessCard
        source={created}
        pendingTxHash={pendingTxHash}
        onAgain={() => {
          setCreated(null);
          setPendingTxHash(undefined);
        }}
      />
    );
  }

  const price = parseFloat(fetchPrice) || 0;
  const isSubmitting = loading || isMining;

  return (
    <div className="border border-ink bg-paper p-7">
      <div className="space-y-6">
        <div className="space-y-2">
          <Label
            htmlFor="rss"
            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
          >
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
            One click — we read your feed and register you on-chain. You earn on every citation.
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
              <Label
                htmlFor="name"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
              >
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
              <Label
                htmlFor="desc"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
              >
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
                <Label
                  htmlFor="price"
                  className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
                >
                  Price per read
                </Label>
                <span className="font-display text-[22px] font-bold tabular-nums text-seal">
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
          disabled={isSubmitting}
          className="flex w-full items-center justify-center gap-2 border border-ink bg-seal px-4 py-3.5 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_5px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="h-4 w-4" />
          )}
          {isMining
            ? "Confirming on-chain…"
            : loading
            ? "Registering…"
            : "Publish source ▸"}
        </button>
      </div>
    </div>
  );
}

function SuccessCard({
  source,
  pendingTxHash,
  onAgain,
}: {
  source: CreatedSource;
  pendingTxHash?: `0x${string}`;
  onAgain: () => void;
}) {
  return (
    <div className="overflow-hidden border border-ink bg-paper animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-2 border-b border-ink bg-paid/[0.08] px-6 py-4">
        <PartyPopper className="h-5 w-5 text-paid" />
        <span className="font-display text-lg font-medium text-ink">
          You&apos;re live, {source.name}
        </span>
      </div>
      <div className="space-y-4 p-6">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Tolls settle to your connected wallet
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
        {pendingTxHash && (
          <a
            href={`https://testnet.arcscan.app/tx/${pendingTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[11px] text-seal hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View on ArcScan
          </a>
        )}
        {pendingTxHash && (
          <p className="font-mono text-[10px] text-ink-3">
            The registry indexer will surface your source in the list within a few seconds.
          </p>
        )}
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
