"use client";

/**
 * Creator onboarding form. Primary path: paste an RSS URL → one-click register.
 * Optional manual fields (name, description, price-per-read dial).
 *
 * Two-phase submit when the on-chain registry is configured:
 *   1. POST /api/sources → server returns { mode:"onchain", registerParams, registryAddress }
 *   2. Client calls useWriteContract → registry.register(...) — creator signs + pays gas
 *   3. Confirm the mined registration event, then observe indexing separately.
 *
 * When the registry is NOT configured (offline dev), the server returns { mode:"offline" }
 * and the source row is written to DB immediately (same as Phase 01 behaviour).
 *
 * Styled as a banknote registration slip (The Mint aesthetic).
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2, Rss, Wallet, PartyPopper, ExternalLink, ShieldCheck, Copy, Webhook } from "lucide-react";
import { toast } from "sonner";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { fmtUsdc } from "./phase-style";
import { confirmsIndex, confirmsRegistration, registrationId, registrationTitles, walletRequestWasRejected, type RegistrationIdentity, type RegistrationPhase } from "@/lib/sources/registration-status";
import { REGISTRY_ABI } from "@/lib/registry/registry-abi";
import { browserPaymentProfile, browserRegistryAddress } from "@/lib/browser-payment-profile";
import { FeedVerificationPanel } from "./feed-verification-panel";

interface CreatedSource {
  id: string;
  name: string;
  walletAddress: string;
  fetchPrice: number;
  authors: { name: string; splitWeight: number }[];
  /** false until feed ownership is proven — the source is listed but earns nothing yet. */
  verified?: boolean;
}

/** Returned by POST /api/sources when the new source isn't verified yet. */
interface Verification {
  token: string;
  canVerify: boolean;
  instructions: string;
}

interface GapIntentReceipt {
  id: string;
  gapId: string;
  claim: string;
  status: "pending" | "running" | "filled" | "missed" | "unpaid" | "stale" | "failed";
}

interface OnchainRegisterParams {
  urlHash: `0x${string}`; // keccak256(toBytes(canonicalUrl)) — contract derives id on-chain
  payoutWallet: `0x${string}`;
  authors: { wallet: `0x${string}`; basisPoints: number }[];
  fetchPriceUsdc6: string; // BigInt serialised as string (JSON can't carry BigInt)
  contentCid: string;
  tags: string;
}

/** Initial field values — used to pre-fill a claim of a pre-registry source. Applied once on
 *  mount, so pass a fresh `key` alongside a new prefill to re-initialise the form. */
export interface RegisterPrefill {
  rssUrl?: string;
  name?: string;
  url?: string;
  description?: string;
  fetchPrice?: number;
  gapId?: string;
  matchedItemLink?: string;
  sourceClaimId?: string;
}

export function RegisterForm({
  onCreated,
  prefillWalletAddress,
  prefill,
}: {
  onCreated?: () => void;
  /** Connected wallet address pre-filled from SIWE session — sent to the server
   *  so the POST handler can override it with the session-verified address. */
  prefillWalletAddress?: string;
  prefill?: RegisterPrefill;
}) {
  const [rssUrl, setRssUrl] = useState(prefill?.rssUrl ?? "");
  const [name, setName] = useState(prefill?.name ?? "");
  const [url, setUrl] = useState(prefill?.url ?? "");
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [fetchPrice, setFetchPrice] = useState(
    prefill?.fetchPrice !== undefined ? String(prefill.fetchPrice) : "0.016",
  );
  const [notifyUrl, setNotifyUrl] = useState("");
  // A prefill without a feed can only go through the manual fields — open them.
  const [showManual, setShowManual] = useState(
    Boolean(prefill && !prefill.rssUrl && (prefill.url || prefill.name)),
  );
  const [loading, setLoading] = useState(false);
  const [created, setCreated] = useState<CreatedSource | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  // One-time webhook secret returned at register time — shown once, never re-fetchable.
  const [notify, setNotify] = useState<{ url: string; secret: string } | null>(null);
  const [gapIntent, setGapIntent] = useState<GapIntentReceipt | null>(null);

  // wagmi hooks for the on-chain register call (only used when registry is configured).
  const { writeContractAsync } = useWriteContract();
  const wallet = useAccount();
  const walletRef = useRef(wallet);
  useLayoutEffect(() => { walletRef.current = wallet; }, [wallet]);
  const publicClient = usePublicClient({ chainId: browserPaymentProfile().chainId });
  const [pendingTxHash, setPendingTxHash] = useState<`0x${string}` | undefined>();
  const [phase, setPhase] = useState<RegistrationPhase>("offline");
  const [statusMessage, setStatusMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const attempt = useRef(0);
  const busy = useRef(false);
  const mounted = useRef(true);
  const pending = useRef<(RegistrationIdentity & { hash: `0x${string}`; sourceId: string; eventConfirmed: boolean }) | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const checkRegistration = async (generation = attempt.current) => {
    const target = pending.current;
    if (!target || !publicClient || busy.current) return;
    busy.current = true;
    setChecking(true);
    const current = () => mounted.current && generation === attempt.current && pending.current === target;
    try {
      if (!target.eventConfirmed) {
        setPhase("mining");
        setStatusMessage("Waiting for a mined registration receipt. Do not resubmit this registration.");
        const receipt = await publicClient.waitForTransactionReceipt({ hash: target.hash, timeout: 60_000 });
        if (!current()) return;
        target.hash = receipt.transactionHash;
        setPendingTxHash(receipt.transactionHash);
        if (receipt.status === "reverted") {
          setPhase("failed"); setStatusMessage("Transaction reverted. This attempt did not register the source."); return;
        }
        if (!confirmsRegistration(receipt, target)) {
          setPhase("failed"); setStatusMessage("Transaction mined without the expected registration event. It may have been cancelled or replaced; this attempt did not confirm registration."); return;
        }
        target.eventConfirmed = true;
        setPhase("indexing");
        setStatusMessage(prefill?.sourceClaimId ? "Registration confirmed on-chain. Indexing is not yet confirmed; claim policy activation is still required before earning." : "Registration confirmed on-chain. Indexing is not yet confirmed; feed ownership is still required before earning.");
      }
      // One exact owner-only read per check; never treat elapsed time as indexing evidence.
      const res = await fetch(`/api/creator/${encodeURIComponent(target.sourceId)}/listing`, { signal: AbortSignal.timeout(10_000) });
      const data: unknown = res.ok ? await res.json() : null;
      if (!current()) return;
      if (confirmsIndex(data, target)) {
        setPhase("indexed"); setStatusMessage(prefill?.sourceClaimId ? "Registration confirmed and indexed. Return to your source claim to review and explicitly activate its policy." : "Registration confirmed and indexed. Verify feed ownership before this source can earn.");
        onCreated?.();
      } else {
        setPhase("indexing"); setStatusMessage("Registration confirmed on-chain. Indexing is not yet confirmed. Check again later; do not resubmit this registration.");
      }
    } catch {
      if (current()) {
        setPhase(target.eventConfirmed ? "indexing" : "unknown");
        setStatusMessage(target.eventConfirmed
          ? "Registration confirmed on-chain; the index could not be checked. Check again later."
          : "Confirmation could not be established. The transaction may still mine. Check its status; do not resubmit this registration.");
      }
    } finally {
      if (current()) { busy.current = false; setChecking(false); }
    }
  };

  const submit = async () => {
    if (busy.current || pending.current) return;
    const requestedPrice = Number(fetchPrice);
    if (!fetchPrice.trim() || !Number.isFinite(requestedPrice) || requestedPrice < 0 || !Number.isSafeInteger(Math.round(requestedPrice * 1_000_000)) || Math.round(requestedPrice * 1_000_000) / 1_000_000 !== requestedPrice) {
      toast.error("Use an exact, nonnegative USDC read price with at most six decimal places.");
      return;
    }
    const baseBody = {
      ...(prefill?.sourceClaimId ? { sourceClaimId: prefill.sourceClaimId } : {}),
      ...(prefillWalletAddress ? { walletAddress: prefillWalletAddress } : {}),
      ...(notifyUrl.trim() ? { notifyUrl: notifyUrl.trim() } : {}),
      ...(prefill?.gapId && prefill.matchedItemLink
        ? {
            gapId: prefill.gapId,
            matchedItemLink: prefill.matchedItemLink,
          }
        : {}),
    };
    // The price the creator picked is written into the register() call, so it must reach the server
    // on BOTH paths — a feed-listed source that omitted it fell back to the server's default and
    // silently ignored the slider. The canonical url binds the on-chain source id; a feed carries
    // its own, a manual source has to be told.
    const body = rssUrl.trim()
      ? { ...baseBody, rssUrl: rssUrl.trim(), ...(prefill?.sourceClaimId && url.trim() ? { url: url.trim() } : {}), fetchPrice: requestedPrice }
      : {
          ...baseBody,
          name: name.trim(),
          url: url.trim(),
          description: description.trim(),
          fetchPrice: requestedPrice,
        };

    if (!("rssUrl" in body)) {
      if (!body.name) {
        toast.error("Add an RSS URL or a source name.");
        return;
      }
      if (!body.url) {
        toast.error("A manual source needs its URL — it's what binds the source to your wallet.");
        return;
      }
    }

    busy.current = true;
    const generation = ++attempt.current;
    const current = () => mounted.current && generation === attempt.current;
    let walletRequestStarted = false;
    setLoading(true);
    setStatusMessage("");
    try {
      const res = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!current()) return;
      if (!res.ok) throw new Error((data?.error as string) ?? "Registration failed");

      // Webhook secret (when a notify URL was supplied) — shown once on the success card.
      setNotify((data.notify as { url: string; secret: string } | null) ?? null);
      setGapIntent((data.gapIntent as GapIntentReceipt | null) ?? null);

      if (data.mode === "onchain") {
        // On-chain path: call registry.register() from the creator's connected wallet.
        // The contract derives the sourceId on-chain as keccak256(abi.encode(msg.sender, urlHash)).
        const params = data.registerParams as OnchainRegisterParams;
        const registryAddress = data.registryAddress as `0x${string}`;
        if (!browserPaymentProfile().testnet && registryAddress?.toLowerCase() !== browserRegistryAddress().toLowerCase())
          throw new Error("Registration target differs from the reviewed network registry");
        const returnedSourceId = data.sourceId as string;

        // On-chain rows are indexed unverified — surface the feed-ownership proof step.
        setVerification((data.verification as Verification) ?? null);

        const creator = prefillWalletAddress as `0x${string}` | undefined;
        setPhase("signing");
        setCreated({
          id: returnedSourceId,
          name: ("name" in body && typeof body.name === "string" ? body.name : undefined)
            || ("rssUrl" in body && typeof body.rssUrl === "string" ? body.rssUrl : returnedSourceId),
          walletAddress: params.payoutWallet,
          fetchPrice: Number(params.fetchPriceUsdc6) / 1_000_000,
          verified: data.verification ? false : true,
          authors: params.authors.map(a => ({ name: a.wallet, splitWeight: a.basisPoints / 10_000 })),
        });
        if (!creator || walletRef.current.address?.toLowerCase() !== creator.toLowerCase() || walletRef.current.chainId !== browserPaymentProfile().chainId || !publicClient) {
          throw new Error(`Connect your signed-in creator wallet on ${browserPaymentProfile().label} before signing.`);
        }
        // Initial registration preparation binds payout to the authenticated SIWE session.
        // A wallet switch does not update that session: never sign its preparation as another creator.
        if (params.payoutWallet.toLowerCase() !== creator.toLowerCase()) {
          throw new Error("Sign in again with the connected creator wallet. This prepared registration belongs to another signed-in wallet.");
        }
        if (await publicClient.getChainId() !== browserPaymentProfile().chainId) throw new Error("Registration RPC network changed");
        toast.loading("Waiting for wallet signature...", { id: "register-tx" });

        walletRequestStarted = true;
        const txHash = await writeContractAsync({
          account: creator,
          chainId: browserPaymentProfile().chainId,
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

        if (!current()) return;
        pending.current = { hash: txHash, sourceId: returnedSourceId, registry: registryAddress, creator,
          onchainId: registrationId(creator, params.urlHash), eventConfirmed: false };
        setPendingTxHash(txHash);
        setPhase("mining");
        setStatusMessage("Transaction submitted. Waiting for a mined registration receipt; this source is not confirmed yet.");
        toast.dismiss("register-tx");
        busy.current = false;
        void checkRegistration(generation);
      } else {
        if (!browserPaymentProfile().testnet) throw new Error("Mainnet registration requires confirmed on-chain authority");
        setPhase("offline");
        // Offline / DB-direct path — source written immediately.
        const source = data.source as CreatedSource;
        setCreated(source);
        setVerification((data.verification as Verification) ?? null);
        toast.success(`${source.name} saved locally (offline).`, {
          description: "No on-chain transaction. Feed ownership must be verified before earning.",
        });
        setRssUrl("");
        setName("");
        setDescription("");
        setNotifyUrl("");
        onCreated?.();
      }
    } catch (err) {
      if (!current()) return;
      const unknownSubmission = walletRequestStarted && !walletRequestWasRejected(err);
      setPhase(unknownSubmission ? "unknown" : "failed");
      setStatusMessage(unknownSubmission
        ? "The wallet did not return a transaction hash. Submission is unknown; check your wallet history before taking further action. Do not resubmit this registration."
        : walletRequestStarted
          ? "Registration was not submitted. The wallet request was rejected."
          : err instanceof Error ? err.message : "Registration could not be started.");
      toast.dismiss("register-tx");
      toast.error(err instanceof Error ? err.message : "Registration failed");
    } finally {
      if (current()) { setLoading(false); if (!pending.current) busy.current = false; }
    }
  };

  if (created) {
    return (
      <SuccessCard
        source={created}
        sourceClaimId={prefill?.sourceClaimId}
        verification={verification}
        notify={notify}
        gapIntent={gapIntent}
        pendingTxHash={pendingTxHash}
        phase={phase}
        statusMessage={statusMessage}
        checking={checking || loading}
        onCheck={() => void checkRegistration()}
        onVerified={() => setCreated((c) => (c ? { ...c, verified: true } : c))}
        onAgain={() => {
          attempt.current++;
          busy.current = false;
          pending.current = null;
          setCreated(null);
          setVerification(null);
          setNotify(null);
          setGapIntent(null);
          setPendingTxHash(undefined);
          setStatusMessage("");
          setPhase("offline");
          setRssUrl("");
          setName("");
          setUrl("");
          setDescription("");
          setNotifyUrl("");
        }}
      />
    );
  }

  const price = parseFloat(fetchPrice) || 0;
  const isSubmitting = loading;

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
            readOnly={!!prefill?.sourceClaimId}
            onChange={(e) => setRssUrl(e.target.value)}
            placeholder="https://yourblog.com/feed.xml"
            className="bg-paper-2 font-mono text-sm"
          />
          <p className="text-xs text-ink-2">
            {prefill?.sourceClaimId ? "This feed is bound to your verified source claim. Registration does not activate its earning policy." : "Sign with your wallet, then prove feed ownership before this source can earn. A paid read and a cited answer have separate rewards."}
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
                htmlFor="url"
                className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
              >
                Source URL
              </Label>
              <Input
                id="url"
                value={url}
                readOnly={!!prefill?.sourceClaimId}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://yourblog.com"
                className="bg-card font-mono text-sm"
              />
              <p className="text-xs text-ink-2">
                Bound into your on-chain source id, so nobody else can register this URL.
              </p>
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
          </div>
        )}

        {/* Outside the manual panel: the price is written into register() on both paths, so a
            feed-listed creator must be able to see and set it too. */}
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
          {prefill?.sourceClaimId ? <>
            <Input id="price" type="number" min="0" step="0.000001" value={fetchPrice} onChange={event => setFetchPrice(event.target.value)} className="bg-paper-2" />
            <p className="text-xs text-ink-2">Zero preserves free reads for free or citation-only mode. A positive toll is required for paid mode. This registration stays off the claim&apos;s earning path until you return and explicitly activate its policy.</p>
          </> : <><input
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
          </>}
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="notify"
            className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3"
          >
            <Webhook className="h-3.5 w-3.5 text-seal" /> Citation webhook <span className="text-ink-3/70 normal-case tracking-normal">(optional)</span>
          </Label>
          <Input
            id="notify"
            value={notifyUrl}
            onChange={(e) => setNotifyUrl(e.target.value)}
            placeholder="https://your-agent.com/keryx-hook"
            className="bg-paper-2 font-mono text-sm"
          />
          <p className="text-xs text-ink-2">
            Get a signed POST the instant the agent cites you and pays — no dashboard polling.
          </p>
        </div>

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
          {loading
            ? "Registering…"
            : "Publish source ▸"}
        </button>
      </div>
    </div>
  );
}

function SuccessCard({
  source,
  sourceClaimId,
  verification,
  notify,
  gapIntent,
  pendingTxHash,
  phase, statusMessage, checking, onCheck,
  onVerified,
  onAgain,
}: {
  source: CreatedSource;
  sourceClaimId?: string;
  verification: Verification | null;
  notify: { url: string; secret: string } | null;
  gapIntent: GapIntentReceipt | null;
  pendingTxHash?: `0x${string}`;
  phase: RegistrationPhase;
  statusMessage: string;
  checking: boolean;
  onCheck: () => void;
  onVerified: () => void;
  onAgain: () => void;
}) {
  // Show the proof step only when the source isn't verified yet AND we have a token to show.
  const needsVerify = source.verified === false && verification !== null;
  return (
    <div className="overflow-hidden border border-ink bg-paper animate-in fade-in zoom-in-95 duration-300">
      <div className="flex items-center gap-2 border-b border-ink bg-paid/[0.08] px-6 py-4">
        {phase === "offline" || phase === "indexed" ? <PartyPopper className="h-5 w-5 text-paid" /> : <Wallet className="h-5 w-5 text-seal" />}
        <span className="font-display text-lg font-medium text-ink">
          {registrationTitles[phase]}: {source.name}
        </span>
      </div>
      <div className="space-y-4 p-6">
        {statusMessage && <p role="status" className="text-sm text-ink-2">{statusMessage}</p>}
        {sourceClaimId && <p className="text-sm">This listing is reserved for your verified public-source claim. Earnings remain disabled until its policy is explicitly activated. <a className="underline" href={`/claim-source?claimId=${encodeURIComponent(sourceClaimId)}`}>Return to source claim</a> after indexing.</p>}
        {pendingTxHash && (phase === "unknown" || phase === "indexing") && (
          <button type="button" disabled={checking} onClick={onCheck} className="text-sm text-seal underline disabled:opacity-60">
            {checking ? "Checking status..." : "Check registration status"}
          </button>
        )}
        {needsVerify && !sourceClaimId && (
          verification.canVerify ? <FeedVerificationPanel key={source.id} source={source} onVerified={onVerified} enabled={phase === "offline" || phase === "indexed"} /> : <p className="text-sm">{verification.instructions}</p>
        )}
        {notify && <NotifySecretPanel notify={notify} />}
        {gapIntent && <GapIntentPanel intent={gapIntent} />}
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            Configured payout wallet
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
            href={`${browserPaymentProfile().explorerUrl}/tx/${pendingTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 font-mono text-[11px] text-seal hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            View on ArcScan
          </a>
        )}
        {!sourceClaimId && <button
          type="button"
          onClick={onAgain}
          disabled={checking || phase === "signing" || phase === "mining" || phase === "unknown" || phase === "indexing"}
          className="w-full rounded-md border border-line px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-paper-2"
        >
          Register another source
        </button>}
      </div>
    </div>
  );
}

function GapIntentPanel({ intent }: { intent: GapIntentReceipt }) {
  return (
    <div className="rounded-md border border-seal/40 bg-seal/[0.06] p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-seal">
        Targeted retry queued
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">
        Once this source is indexed and feed ownership is verified, Keryx will retry the paid
        question with a bounded treasury budget. The claim counts as filled only if this post
        supplies qualifying evidence and its citation reward really settles.
      </p>
      <p className="mt-2 font-serif text-[14px] leading-snug text-ink">
        “{intent.claim}”
      </p>
    </div>
  );
}

/**
 * One-time reveal of the webhook signing secret. Shown only right after registration (the server
 * never returns it again). The creator stores it to verify the `X-Keryx-Signature` HMAC on each
 * citation delivery. Rotatable later from the creator's own profile page.
 */
function NotifySecretPanel({ notify }: { notify: { url: string; secret: string } }) {
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied.`);
    } catch {
      toast.error(`Couldn't copy — select and copy the ${label.toLowerCase()} manually.`);
    }
  };
  return (
    <div className="space-y-3 rounded-md border border-seal/40 bg-seal/[0.06] p-4">
      <div className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-seal">
        <Webhook className="h-3.5 w-3.5" />
        Citation webhook armed
      </div>
      <p className="text-xs text-ink-2">
        We&apos;ll POST a signed payload to <span className="break-all font-mono text-ink">{notify.url}</span>{" "}
        each time you&apos;re cited and paid. Save this signing secret now — it is shown once and verifies the{" "}
        <code className="font-mono text-ink">X-Keryx-Signature</code> header.
      </p>
      <div className="flex items-center gap-2">
        <code className="flex-1 break-all rounded border border-line bg-paper px-2.5 py-1.5 font-mono text-xs text-ink">
          {notify.secret}
        </code>
        <button
          type="button"
          onClick={() => copy(notify.secret, "Secret")}
          title="Copy secret"
          className="shrink-0 rounded-md border border-line px-2 py-1.5 text-ink transition-colors hover:bg-paper-2"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="font-mono text-[10px] text-ink-3">
        Verify: <code>sha256=hex(hmac_sha256(secret, rawBody))</code>
      </p>
    </div>
  );
}
