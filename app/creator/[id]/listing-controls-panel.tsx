"use client";

/**
 * Owner-only listing controls: the price-per-read dial and the permanent delist switch. Self-
 * gating like the other owner panels — GET /api/creator/[id]/listing answers 401/403 for anyone
 * but the owner, so non-owners render nothing.
 *
 * On-chain sources: the creator's connected wallet signs registry.update()/deactivate() itself
 * (the contract's onlyCreator is the real gate) and the indexer projects the event back into the
 * cache within seconds. Offline sources: a plain POST writes the DB row directly.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { arcTestnet } from "viem/chains";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { REGISTRY_ABI } from "@/lib/registry/registry-client";
import { parseListingSnapshot, sameListingSnapshot } from "@/lib/creator/listing-snapshot";

interface ListingData {
  mode: "onchain" | "offline";
  fetchPrice: number;
  active: boolean;
  registryAddress?: `0x${string}`;
  onchainId?: `0x${string}`;
  creator?: `0x${string}`;
  current?: {
    payoutWallet: `0x${string}`;
    authors: { wallet: `0x${string}`; basisPoints: number }[];
    fetchPriceUsdc6: string;
    contentCid: string;
    tags: string;
  };
}

export function ListingControlsPanel({ creatorId }: { creatorId: string }) {
  const [data, setData] = useState<ListingData | null>(null); // null until proven owner
  const [price, setPrice] = useState("0");
  const [busy, setBusy] = useState(false);
  const [delistArmed, setDelistArmed] = useState(false);
  const [reviewRequired, setReviewRequired] = useState(false);

  const { address: connected, chainId } = useAccount();
  const actionLock = useRef(false);
  const identity = useRef({ creatorId, connected, chainId, active: false });
  useLayoutEffect(() => {
    identity.current = { creatorId, connected, chainId, active: true };
    return () => { identity.current.active = false; };
  }, [creatorId, connected, chainId]);
  const { writeContractAsync } = useWriteContract();
  const [pendingTx, setPendingTx] = useState<`0x${string}` | undefined>();
  const { isLoading: isMining, isSuccess: mined, data: receipt } = useWaitForTransactionReceipt({
    hash: pendingTx,
    chainId: arcTestnet.id,
  });

  const load = async () => {
    try {
      const res = await fetch(`/api/creator/${creatorId}/listing`, { cache: "no-store" });
      if (!res.ok) return; // 401/403/404 → not the owner, stay hidden
      const value = (await res.json()) as ListingData;
      const d = value.mode === "onchain" ? parseListingSnapshot(value) : value;
      setData(d);
      setPrice(String(d.fetchPrice));
    } catch {
      /* stay hidden */
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creatorId]);

  // Once the tx mines, give the indexer its ≤4s to project the event, then re-read.
  useEffect(() => {
    if (!mined || !receipt) return;
    if (receipt.status === "success") toast.success("Transaction confirmed. Refreshing registry state.");
    else toast.error("Transaction reverted. Listing changes were not confirmed.");
    const t = setTimeout(() => {
      void load();
      setPendingTx(undefined);
    }, 4_500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined, receipt]);

  if (!data) return null;

  const parsedPrice = parseFloat(price) || 0;
  const priceChanged = Math.abs(parsedPrice - data.fetchPrice) >= 0.0000005;
  const working = busy || isMining;
  const wrongWallet =
    data.mode === "onchain" &&
    (!connected || !data.creator || connected.toLowerCase() !== data.creator.toLowerCase());
  const wrongNetwork = data.mode === "onchain" && chainId !== arcTestnet.id;
  const signingUnavailable = wrongWallet || wrongNetwork;

  const refreshBeforeSigning = async () => {
    const owner = identity.current;
    const res = await fetch(`/api/creator/${creatorId}/listing`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error("Listing authority could not be refreshed. No signature requested.");
    const fresh = parseListingSnapshot(await res.json());
    if (!owner.active || identity.current !== owner || owner.creatorId !== creatorId
      || owner.chainId !== arcTestnet.id || owner.connected?.toLowerCase() !== fresh.creator) {
      throw new Error("Wallet or source changed. Refresh before signing.");
    }
    if (!sameListingSnapshot(data, fresh)) {
      setData(fresh); setPrice(String(fresh.fetchPrice)); setDelistArmed(false); setReviewRequired(true);
      throw new Error("Listing changed. Review the refreshed details and choose your change again.");
    }
    if (!fresh.active) throw new Error("This source is delisted.");
    setReviewRequired(false);
    return fresh;
  };

  const savePrice = async () => {
    if (working || !priceChanged || signingUnavailable || actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    try {
      if (data.mode === "onchain" && data.current && data.registryAddress && data.onchainId) {
        const fresh = await refreshBeforeSigning();
        toast.loading("Waiting for wallet signature…", { id: "listing-tx" });
        const txHash = await writeContractAsync({
          account: connected,
          chainId: arcTestnet.id,
          address: fresh.registryAddress,
          abi: REGISTRY_ABI,
          functionName: "update",
          args: [
            fresh.onchainId,
            fresh.current.payoutWallet,
            fresh.current.authors,
            BigInt(Math.round(parsedPrice * 1_000_000)),
            fresh.current.contentCid,
            fresh.current.tags,
          ],
        });
        setPendingTx(txHash);
        toast.loading("Price update submitted — confirming…", { id: "listing-tx" });
      } else {
        const res = await fetch(`/api/creator/${creatorId}/listing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fetchPrice: parsedPrice }),
        });
        const d = (await res.json()) as { fetchPrice?: number; error?: string };
        if (!res.ok) throw new Error(d.error ?? "Failed to save");
        setData({ ...data, fetchPrice: d.fetchPrice ?? parsedPrice });
        toast.success(`Price per read is now $${fmtUsdc(d.fetchPrice ?? parsedPrice)}.`);
      }
    } catch (e) {
      toast.dismiss("listing-tx");
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  const delist = async () => {
    if (working || signingUnavailable || actionLock.current) return;
    if (!delistArmed) {
      setDelistArmed(true);
      setTimeout(() => setDelistArmed(false), 6_000);
      return;
    }
    setDelistArmed(false);
    actionLock.current = true;
    setBusy(true);
    try {
      if (data.mode === "onchain" && data.registryAddress && data.onchainId) {
        const fresh = await refreshBeforeSigning();
        toast.loading("Waiting for wallet signature…", { id: "listing-tx" });
        const txHash = await writeContractAsync({
          account: connected,
          chainId: arcTestnet.id,
          address: fresh.registryAddress,
          abi: REGISTRY_ABI,
          functionName: "deactivate",
          args: [fresh.onchainId],
        });
        setPendingTx(txHash);
        toast.loading("Delist submitted — confirming…", { id: "listing-tx" });
      } else {
        const res = await fetch(`/api/creator/${creatorId}/listing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deactivate" }),
        });
        const d = (await res.json()) as { active?: boolean; error?: string };
        if (!res.ok) throw new Error(d.error ?? "Failed to delist");
        setData({ ...data, active: false });
        toast.success("Source delisted — the agent will no longer read or cite it.");
      }
    } catch (e) {
      toast.dismiss("listing-tx");
      toast.error(e instanceof Error ? e.message : "Failed to delist");
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Banknote className="h-3.5 w-3.5 text-seal" /> Listing controls
      </h2>

      {!data.active ? (
        <p className="max-w-xl font-serif text-[13px] text-ink-2">
          This source is <span className="text-destructive">delisted</span> — the agent no longer
          discovers, reads, or cites it. Its earnings history stays on the ledger.
        </p>
      ) : (
        <>
          <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
            The toll you charge per read. The agent weighs it against its budget on every dispatch
            — priced too high, it simply buys elsewhere.
            {data.mode === "onchain" &&
              " Changes are signed by your wallet and written to the on-chain registry."}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  Price per read
                </span>
                <span className="font-display text-[20px] font-bold tabular-nums text-seal">
                  ${fmtUsdc(parsedPrice)}
                </span>
              </div>
              <input
                type="range"
                min={0.001}
                max={0.04}
                step={0.001}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                disabled={working}
                className="w-full cursor-pointer"
              />
              <div className="flex justify-between font-mono text-[10px] text-ink-3">
                <span>$0.001</span>
                <span className="text-ink-2">now ${fmtUsdc(data.fetchPrice)}</span>
                <span>$0.040</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void savePrice()}
              disabled={working || !priceChanged || signingUnavailable}
              className="flex items-center justify-center gap-2 border border-ink bg-seal px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-cream transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              {isMining ? "Confirming…" : "Save price"}
            </button>
          </div>

          {wrongWallet && (
            <p className="mt-3 font-mono text-[10px] text-amber-700">
              This source was registered by {shortAddr(data.creator!)} — only that wallet&apos;s
              signature will pass the registry. Switch accounts before signing.
            </p>
          )}
          {wrongNetwork && (
            <p className="mt-3 font-mono text-[10px] text-amber-700">
              Connect your creator wallet on Arc Testnet before changing this listing.
            </p>
          )}

          {data.mode === "onchain" && data.current && (
            <details className="mt-4 border-t border-line pt-3 text-ink-3" open={reviewRequired}>
              <summary className="cursor-pointer font-mono text-[11px]">Current registry details</summary>
              {reviewRequired && <p className="mt-2 text-sm text-amber-700">The listing changed. Review these details before choosing your change again.</p>}
              <p className="mt-2 text-xs">Price updates also submit these fields. Avoid editing this source elsewhere while the wallet prompt is open.</p>
              <dl className="mt-3 space-y-2 break-all font-mono text-[11px]">
                <div><dt>Payout wallet</dt><dd>{data.current.payoutWallet}</dd></div>
                <div><dt>Author splits</dt><dd>{data.current.authors.length ? data.current.authors.map((a, i) => (
                  <p key={`${a.wallet}-${i}`}>{a.wallet}: {a.basisPoints / 100}%</p>
                )) : "Payout wallet receives 100%."}</dd></div>
                <div><dt>Content reference</dt><dd>{data.current.contentCid || "None"}</dd></div>
                <div><dt>Tags</dt><dd>{data.current.tags || "None"}</dd></div>
              </dl>
            </details>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-md font-serif text-[12px] text-ink-3">
              Delisting is permanent: the agent stops reading and citing this source. Earnings
              already settled stay yours.
            </p>
            <button
              type="button"
              onClick={() => void delist()}
              disabled={working || signingUnavailable}
              className={
                "flex items-center gap-1.5 border px-3 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors disabled:opacity-60 " +
                (delistArmed
                  ? "border-destructive bg-destructive/10 text-destructive"
                  : "border-line text-ink-3 hover:border-destructive/50 hover:text-destructive")
              }
            >
              <Archive className="h-3.5 w-3.5" />
              {delistArmed ? "Click again to confirm — permanent" : "Delist source"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
