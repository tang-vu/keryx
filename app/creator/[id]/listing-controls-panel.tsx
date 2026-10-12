"use client";
import { SigningAmount } from "@/components/keryx/signing-amount";

/**
 * Owner-only listing controls: the price-per-read dial and the permanent delist switch. Self-
 * gating like the other owner panels — GET /api/creator/[id]/listing answers 401/403 for anyone
 * but the owner, so non-owners render nothing.
 *
 * On-chain sources: the creator's connected wallet signs registry.update()/deactivate() itself
 * (the contract's onlyCreator is the real gate) and the indexer projects the event back into the
 * cache within seconds. Offline sources: a plain POST writes the DB row directly.
 */

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { arcChain } from "@/lib/chains";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { currentArcLabel } from "@/lib/arc-network-display";
import { parseUnits } from "viem";
import { fmtUsdc, shortAddr } from "@/components/keryx/phase-style";
import { type RegistryVersion } from "@/lib/registry/registry-version";
import { assertBrowserListingRegistryOrigin } from "@/lib/registry/browser-source-registry-authority";
import { listingPriceCall, listingDeactivateCall } from "@/lib/creator/listing-call";
import { REGISTRY_ABI, REVISIONED_REGISTRY_ABI } from "@/lib/registry/registry-abi";
import { parseListingSnapshot, sameListingSnapshot } from "@/lib/creator/listing-snapshot";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface ListingData {
  mode: "onchain" | "offline";
  fetchPrice: number;
  active: boolean;
  registryAddress?: `0x${string}`;
  onchainId?: `0x${string}`;
  creator?: `0x${string}`;
  registryVersion?: RegistryVersion;
  revision?: string;
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
    chainId: arcChain.id,
  });

  const load = async () => {
    try {
      const res = await fetch(`/api/creator/${creatorId}/listing`, { cache: "no-store" });
      if (!res.ok) return; // 401/403/404 → not the owner, stay hidden
      const value = (await res.json()) as ListingData;
      const d = value.mode === "onchain" ? parseListingSnapshot(value) : value;
      if (d.mode === "onchain") {
        if (!d.registryAddress || d.registryVersion === undefined) throw new Error(uiCopy("creatorListing.authorityUnavailable"));
        assertBrowserListingRegistryOrigin(d.registryAddress, d.registryVersion);
      }
      if (!browserPaymentProfile().testnet && d.mode !== "onchain") throw new Error(uiCopy("creatorListing.authorityUnavailable"));
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
    if (receipt.status === "success") toast.success(uiCopy("creatorListing.confirmed"));
    else toast.error(uiCopy("creatorListing.reverted"));
    const t = setTimeout(() => {
      void load();
      setPendingTx(undefined);
    }, 4_500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mined, receipt]);

  if (!data) return null;

  const parsedPriceMicros=/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price)?parseUnits(price,6):null;
  const priceValid=parsedPriceMicros!==null&&parsedPriceMicros<=BigInt(Number.MAX_SAFE_INTEGER);
  const parsedPrice=priceValid?Number(parsedPriceMicros)/1e6:NaN;
  const priceChanged=priceValid&&(data.current?parsedPriceMicros!==BigInt(data.current.fetchPriceUsdc6):parsedPrice!==data.fetchPrice);
  const working = busy || isMining;
  const wrongWallet =
    data.mode === "onchain" &&
    (!connected || !data.creator || connected.toLowerCase() !== data.creator.toLowerCase());
  const wrongNetwork = data.mode === "onchain" && chainId !== arcChain.id;
  const signingUnavailable = wrongWallet || wrongNetwork;

  const refreshBeforeSigning = async () => {
    const owner = identity.current;
    const res = await fetch(`/api/creator/${creatorId}/listing`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(uiCopy("creatorListing.authorityUnavailable"));
    const fresh = parseListingSnapshot(await res.json());
    if (!owner.active || identity.current !== owner || owner.creatorId !== creatorId
      || owner.chainId !== arcChain.id || owner.connected?.toLowerCase() !== fresh.creator) {
      throw new Error(uiCopy("creatorListing.identityChanged"));
    }
    assertBrowserListingRegistryOrigin(fresh.registryAddress, fresh.registryVersion);
    if (!sameListingSnapshot(data, fresh)) {
      setData(fresh); setPrice(String(fresh.fetchPrice)); setDelistArmed(false); setReviewRequired(true);
      throw new Error(uiCopy("creatorListing.changed"));
    }
    if (!fresh.active) throw new Error(uiCopy("creatorListing.inactive"));
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
        toast.loading(uiCopy("creatorListing.waiting"), { id: "listing-tx" });
        const call = listingPriceCall(fresh, parsedPriceMicros!);
        const wallet = { account: connected, chainId: arcChain.id, address: call.address };
        const txHash = call.functionName === "updatePrice"
          ? await writeContractAsync({ ...wallet, abi: call.abi, functionName: call.functionName, args: call.args })
          : await writeContractAsync({ ...wallet, abi: call.abi, functionName: call.functionName, args: call.args });
        setPendingTx(txHash);
        toast.loading(uiCopy("creatorListing.priceSubmitted"), { id: "listing-tx" });
      } else {
        const res = await fetch(`/api/creator/${creatorId}/listing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fetchPrice: parsedPrice }),
        });
        const d = (await res.json()) as { fetchPrice?: number; error?: string };
        if (!res.ok) throw new Error(d.error ?? uiCopy("creatorListing.saveFailed"));
        setData({ ...data, fetchPrice: d.fetchPrice ?? parsedPrice });
        toast.success(uiCopy("creatorListing.updated", { price: fmtUsdc(d.fetchPrice ?? parsedPrice) }));
      }
    } catch (e) {
      toast.dismiss("listing-tx");
      toast.error(e instanceof Error ? e.message : uiCopy("creatorListing.saveFailed"));
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
        toast.loading(uiCopy("creatorListing.waiting"), { id: "listing-tx" });
        const call = listingDeactivateCall(fresh);
        const wallet = { account: connected, chainId: arcChain.id, address: call.address };
        const txHash = call.args.length === 2
          ? await writeContractAsync({ ...wallet, abi: REVISIONED_REGISTRY_ABI, functionName: "deactivate", args: call.args })
          : await writeContractAsync({ ...wallet, abi: REGISTRY_ABI, functionName: "deactivate", args: call.args });
        setPendingTx(txHash);
        toast.loading(uiCopy("creatorListing.delistSubmitted"), { id: "listing-tx" });
      } else {
        const res = await fetch(`/api/creator/${creatorId}/listing`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "deactivate" }),
        });
        const d = (await res.json()) as { active?: boolean; error?: string };
        if (!res.ok) throw new Error(d.error ?? uiCopy("creatorListing.delistFailed"));
        setData({ ...data, active: false });
        toast.success(uiCopy("creatorListing.delisted"));
      }
    } catch (e) {
      toast.dismiss("listing-tx");
      toast.error(e instanceof Error ? e.message : uiCopy("creatorListing.delistFailed"));
    } finally {
      actionLock.current = false;
      setBusy(false);
    }
  };

  return (
    <section className="mb-8 border border-line bg-paper p-5">
      <h2 className="mb-1 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
        <Banknote className="h-3.5 w-3.5 text-seal" /> {uiCopy("creatorListing.title")}
      </h2>

      {!data.active ? (
        <p className="max-w-xl font-serif text-[13px] text-ink-2">
          {uiRichCopy("creatorListing.inactiveDescription", { delisted: <span className="text-destructive">{uiCopy("creatorListing.delistedLabel")}</span> })}
        </p>
      ) : (
        <>
          <p className="mb-4 max-w-xl font-serif text-[13px] text-ink-2">
            {data.mode === "onchain" ? uiCopy("creatorListing.onchainDescription") : uiCopy("creatorListing.offlineDescription")}
          </p>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                  {uiCopy("creatorListing.price")}
                </span>
                <span className="font-display text-[20px] font-bold tabular-nums text-seal">
                  ${fmtUsdc(parsedPrice)}
                </span>
              </div>
              {priceValid && <p className="text-xs"><SigningAmount micros={parsedPriceMicros} /></p>}
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
                <span className="text-ink-2">{uiCopy("creatorListing.currentPrice", { price: fmtUsdc(data.fetchPrice) })}</span>
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
              {isMining ? uiCopy("creatorListing.confirming") : uiCopy("creatorListing.save")}
            </button>
          </div>

          {wrongWallet && (
            <p className="mt-3 font-mono text-[10px] text-amber-700">
              {uiCopy("creatorListing.walletInstruction", { wallet: shortAddr(data.creator!) })}
            </p>
          )}
          {wrongNetwork && (
            <p className="mt-3 font-mono text-[10px] text-amber-700">
              {uiCopy("creatorListing.networkInstruction", { network: currentArcLabel })}
            </p>
          )}

          {data.mode === "onchain" && data.current && (
            <details className="mt-4 border-t border-line pt-3 text-ink-3" open={reviewRequired}>
              <summary className="cursor-pointer font-mono text-[11px]">{uiCopy("creatorListing.details")}</summary>
              {reviewRequired && <p className="mt-2 text-sm text-amber-700">{uiCopy("creatorListing.reviewChanged")}</p>}
              <p className="mt-2 text-xs">{data.registryVersion === 2 || data.registryVersion === 3
                ? copy.priceOnlyUpdateExplanation
                : copy.legacyPriceUpdateExplanation}</p>
              <dl className="mt-3 space-y-2 break-all font-mono text-[11px]">
                <div><dt>{uiCopy("creatorListing.payoutWallet")}</dt><dd>{data.current.payoutWallet}</dd></div>
                <div><dt>{uiCopy("creatorListing.authorSplits")}</dt><dd>{data.current.authors.length ? data.current.authors.map((a, i) => (
                  <p key={`${a.wallet}-${i}`}>{a.wallet}: {a.basisPoints / 100}%</p>
                )) : uiCopy("creatorListing.payoutAll")}</dd></div>
                <div><dt>{uiCopy("creatorListing.contentReference")}</dt><dd>{data.current.contentCid || uiCopy("creatorListing.none")}</dd></div>
                <div><dt>{uiCopy("creatorListing.tags")}</dt><dd>{data.current.tags || uiCopy("creatorListing.none")}</dd></div>
              </dl>
            </details>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="max-w-md font-serif text-[12px] text-ink-3">
              {uiCopy("creatorListing.delistBoundary")}
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
              {delistArmed ? uiCopy("creatorListing.confirmDelist") : uiCopy("creatorListing.delist")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
