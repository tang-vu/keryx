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

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Loader2, Wallet, Upload, ListPlus } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import type { Address, Hex } from "viem";
import { fmtUsdc } from "./phase-style";
import { REGISTRY_ABI } from "@/lib/registry/registry-abi";
import { browserPaymentProfile, browserRegistryAddress } from "@/lib/browser-payment-profile";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { confirmsRegistration, registrationId, walletRequestWasRejected } from "@/lib/sources/registration-status";
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
  const [checking, setChecking] = useState(false);

  const account = useAccount();
  const { session } = useSiweAuth();
  const { writeContractAsync } = useWriteContract();
  const profile = browserPaymentProfile();
  const publicClient = usePublicClient({ chainId: profile.chainId });
  const identity = useRef({ address: account.address, chainId: account.chainId, signedIn: session?.address });
  const generation = useRef(0), active = useRef(false), mounted = useRef(true);
  useLayoutEffect(() => {
    const registration = generation;
    mounted.current = true;
    identity.current = { address: account.address, chainId: account.chainId, signedIn: session?.address };
    return () => { registration.current++; mounted.current = false; };
  }, [account.address, account.chainId, session?.address]);

  const captureOwner = (requireNetwork = true) => {
    const creator = identity.current.signedIn as Address | undefined;
    if (!creator || identity.current.address?.toLowerCase() !== creator.toLowerCase()
      || (requireNetwork && (identity.current.chainId !== profile.chainId || !publicClient)))
      throw new Error(`Connect your signed-in creator wallet on ${profile.label} before continuing.`);
    const revision = generation.current;
    return { creator, assertCurrent: () => {
      if (!mounted.current || generation.current !== revision
        || identity.current.address?.toLowerCase() !== creator.toLowerCase()
        || identity.current.signedIn?.toLowerCase() !== creator.toLowerCase()
        || (requireNetwork && identity.current.chainId !== profile.chainId))
        throw new Error("Creator wallet or network changed. The batch stopped; check any original transaction before continuing.");
    } };
  };

  const registrationIdentity = (feed: PreparedFeed, creator: Address) => {
    if (feed.mode !== "onchain" || !feed.registerParams || !feed.registryAddress
      || !/^0x[0-9a-f]{40}$/i.test(feed.registryAddress)
      || !/^0x[0-9a-f]{64}$/i.test(feed.registerParams.urlHash)
      || feed.registerParams.payoutWallet.toLowerCase() !== creator.toLowerCase())
      throw new Error("Prepared registration differs from your signed-in creator wallet. Read the feeds again.");
    if (!profile.testnet && feed.registryAddress.toLowerCase() !== browserRegistryAddress().toLowerCase())
      throw new Error("Registration target differs from the reviewed network registry.");
    return { registry: feed.registryAddress, creator, onchainId: registrationId(creator, feed.registerParams.urlHash) };
  };

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
    if (active.current || feeds.some(f => ["signing", "confirming", "unknown"].includes(f.phase))) return;
    const urls = parseFeedList(input);
    if (urls.length === 0) {
      toast.error("Paste at least one feed URL, or load an OPML file.");
      return;
    }
    active.current = true;
    setPreparing(true);
    setVerifiedCount(0);
    try {
      const owner = captureOwner(!profile.testnet);
      const res = await fetch("/api/sources/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feeds: urls, fetchPrice: parseFloat(price) || undefined }),
        signal: AbortSignal.timeout(60_000),
      });
      const data = (await res.json()) as { results?: PreparedFeed[]; error?: string };
      owner.assertCurrent();
      if (!res.ok) throw new Error(data.error ?? "Import failed");
      const prepared = (data.results ?? []).map<PreparedFeed>((r) => ({
        ...r,
        // On-chain returns the id at the top level; the offline DB-direct path nests it under
        // `source`. Normalise so Verify-all can key on `sourceId` either way.
        sourceId: r.sourceId ?? (r as { source?: { id?: string } }).source?.id,
        selected: Boolean(r.ok),
        phase: (r.ok ? (r.mode === "offline" ? "done" : "ready") : "failed") as BulkPhase,
      }));
      for (const feed of prepared.filter(f => f.ok)) {
        if (!profile.testnet || feed.mode === "onchain") registrationIdentity(feed, owner.creator);
      }
      setFeeds(prepared);
      const ok = prepared.filter((f) => f.ok).length;
      toast.success(`${ok} of ${prepared.length} feeds ready.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Import failed");
    } finally {
      active.current = false;
      if (mounted.current) setPreparing(false);
    }
  };

  const observeRegistration = async (feed: PreparedFeed, hash: Hex, owner: ReturnType<typeof captureOwner>) => {
    const expected = registrationIdentity(feed, owner.creator);
    if (!publicClient || await publicClient.getChainId() !== profile.chainId) throw new Error("Registration RPC network changed");
    owner.assertCurrent();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
    owner.assertCurrent();
    patch(feed.rssUrl, { txHash: receipt.transactionHash });
    if (!confirmsRegistration(receipt, expected)) {
      if (!feed.submittedTxHash || hash.toLowerCase() !== feed.submittedTxHash.toLowerCase()
        || receipt.transactionHash.toLowerCase() !== feed.submittedTxHash.toLowerCase()) {
        patch(feed.rssUrl, { phase: "unknown", error: "This receipt does not confirm the expected registration or resolve the wallet-submitted original. Check the original transaction; do not resubmit." });
        return false;
      }
      patch(feed.rssUrl, { phase: "failed", error: receipt.status === "reverted"
        ? "Transaction reverted. This attempt did not register the source; gas may have been charged."
        : "Transaction mined without the expected registration event. Registration is not confirmed." });
      return true;
    }
    patch(feed.rssUrl, { phase: "done", error: undefined });
    return true;
  };

  const checkRegistration = async (feed: PreparedFeed) => {
    if (active.current || !/^0x[0-9a-f]{64}$/i.test(feed.txHash ?? "")) return;
    active.current = true; setChecking(true);
    try { await observeRegistration(feed, feed.txHash as Hex, captureOwner()); onRegistered?.(); }
    catch (err) { if (mounted.current) patch(feed.rssUrl, { phase: "unknown", error: err instanceof Error ? err.message : "Confirmation remains unknown; do not resubmit." }); }
    finally { active.current = false; if (mounted.current) setChecking(false); }
  };

  const registerSelected = async () => {
    if (active.current || feeds.some(f => ["signing", "confirming", "unknown"].includes(f.phase))) return;
    const targets = feeds.filter(
      (f) => f.selected && f.ok && f.phase === "ready" && f.mode === "onchain" && f.registerParams,
    );
    if (targets.length === 0) {
      toast.error("Nothing ready to register — select at least one ingested feed.");
      return;
    }
    active.current = true;
    setRegistering(true);
    try {
      const owner = captureOwner();
      for (const f of targets) {
        let walletRequestStarted = false;
        try {
          owner.assertCurrent();
          registrationIdentity(f, owner.creator);
          if (!publicClient || await publicClient.getChainId() !== profile.chainId) throw new Error("Registration RPC network changed");
          owner.assertCurrent();
          const p = f.registerParams!;
          patch(f.rssUrl, { phase: "signing", error: undefined });
          walletRequestStarted = true;
          const hash = await writeContractAsync({
            account: owner.creator,
            chainId: profile.chainId,
            address: f.registryAddress!,
            abi: REGISTRY_ABI,
            functionName: "register",
            args: [p.urlHash, p.payoutWallet, p.authors, BigInt(p.fetchPriceUsdc6), p.contentCid, p.tags],
          });
          if (mounted.current) patch(f.rssUrl, { phase: "confirming", txHash: hash, submittedTxHash: hash });
          owner.assertCurrent();
          if (!await observeRegistration({ ...f, submittedTxHash: hash }, hash, owner)) break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Signature rejected";
          const unknown = walletRequestStarted && !walletRequestWasRejected(err);
          if (mounted.current) patch(f.rssUrl, { phase: unknown ? "unknown" : "failed", error: unknown
            ? "Confirmation is unknown. Check the original transaction or enter its hash from wallet activity; do not resubmit. " + msg.slice(0, 160)
            : msg.slice(0, 200) });
          // An unknown wallet result or changed identity never authorizes the next prompt.
          if (unknown) break;
          owner.assertCurrent();
        }
      }
      onRegistered?.();
    } catch (err) {
      if (mounted.current) toast.error(err instanceof Error ? err.message : "Registration stopped");
    } finally {
      active.current = false;
      if (mounted.current) setRegistering(false);
    }
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
  const busy = preparing || registering || verifying || checking;
  const unresolved = feeds.some(f => ["signing", "confirming", "unknown"].includes(f.phase));

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
        disabled={busy || unresolved}
        className="flex w-full items-center justify-center gap-2 border border-ink bg-paper-2 px-4 py-3 font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-ink transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_0_var(--ink)] active:translate-y-0 active:shadow-none disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}
        {preparing ? "Reading feeds…" : "Read feeds ▸"}
      </button>

      <BulkImportResults feeds={feeds} onToggle={toggle} busy={busy}
        onCheck={rssUrl => { const feed = feeds.find(f => f.rssUrl === rssUrl); if (feed) void checkRegistration(feed); }}
        onHashChange={(rssUrl, txHash) => patch(rssUrl, { txHash })} />
      {feeds.some(f => f.phase === "done" && f.mode === "onchain") && <p className="text-xs text-ink-2">Registration confirmed on-chain. Indexing and feed ownership verification may still be pending. If verification is not available yet, check again later in My sources.</p>}

      {pendingOnchain > 0 && (
        <button
          type="button"
          onClick={registerSelected}
          disabled={busy || unresolved}
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
