"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount, useConfig, useSignTypedData } from "wagmi";
import { getConnection } from "wagmi/actions";
import { formatUnits, keccak256, toBytes } from "viem";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile, browserRegistryAddress } from "@/lib/browser-payment-profile";
import { registrationId, confirmsIndex } from "@/lib/sources/registration-status";
import { registrationIntentDigest, registrationTypedData, sponsoredRegistrationSchema, type SponsoredRegistration } from "@/lib/sources/registration-sponsor-protocol";
import { getBrowserRegistryVersion } from "@/lib/registry/registry-version";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";

interface Availability { available: boolean; sponsorAddress?: string; policyDigest?: string; maxGasWei?: string }
const labels: Record<SponsoredRegistration["state"], string> = copy.stateLabels;
export function SponsoredRegistrationForm({ claimId }: { claimId?: string }) {
  const wallet = useAccount(), { session } = useSiweAuth(), { signTypedDataAsync } = useSignTypedData();
  const walletConfig = useConfig();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [claim, setClaim] = useState<{ id: string; canonicalUrl: string; rssUrl?: string; ownerWallet: string } | null>(null);
  const [row, setRow] = useState<SponsoredRegistration | null>(null), [error, setError] = useState("");
  const [price, setPrice] = useState("0.016"), [busy, setBusy] = useState(false), [indexed, setIndexed] = useState(false);
  const [manualId, setManualId] = useState("");
  const current = useRef({ address: wallet.address, session: session?.address, chainId: wallet.chainId });
  useLayoutEffect(() => {
    current.current = { address: wallet.address, session: session?.address, chainId: wallet.chainId };
  }, [wallet.address, session?.address, wallet.chainId]);
  const profile = browserPaymentProfile(), registry = browserRegistryAddress(), owner = wallet.address?.toLowerCase();
  const authenticated = Boolean(owner && session?.address.toLowerCase() === owner && wallet.chainId === profile.chainId);
  const storageKey = owner ? `keryx:registration-sponsor:${profile.chainId}:${registry.toLowerCase()}:${owner}:${claimId || "latest"}` : null;
  const generation = useRef(0), attempted = useRef(new Set<string>());
  const [attemptedIds, setAttemptedIds] = useState<ReadonlySet<string>>(() => new Set());
  async function readJson(url: string, init?: RequestInit) {
    const response = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || copy.requestUnavailable);
    return body;
  }
  function checkedOriginal(value: unknown) {
    const original = sponsoredRegistrationSchema.parse(value), identity = current.current;
    // The connection store can change while React still shows the prior wallet.
    const connection = getConnection(walletConfig);
    if (connection.status !== "connected" || connection.chainId !== profile.chainId || original.creator !== connection.address?.toLowerCase() ||
      identity.chainId !== profile.chainId || original.creator !== identity.address?.toLowerCase() || original.creator !== identity.session?.toLowerCase() ||
      original.chainId !== profile.chainId || original.registryAddress !== registry.toLowerCase() ||
      original.params.payoutWallet !== original.creator || original.onchainId !== registrationId(original.creator, original.params.urlHash) ||
      original.params.urlHash !== keccak256(toBytes(original.canonicalUrl)) || original.id !== registrationIntentDigest(original))
      throw new Error(copy.originalWalletMismatch);
    return original;
  }
  async function inspect(id: string, epoch = generation.current) {
    const body = await readJson(`/api/sources/sponsor?id=${encodeURIComponent(id)}`);
    if (epoch !== generation.current) return;
    const original = checkedOriginal(body.original); setRow(original); setManualId(original.id);
    if (body.recoveryUnavailable) setError(copy.recoveryUnavailable);
    if (original.state === "confirmed") {
      try {
        const listing = await readJson(`/api/creator/${encodeURIComponent(original.sourceId)}/listing`);
        if (epoch === generation.current) setIndexed(confirmsIndex(listing, { creator: original.creator, registry: original.registryAddress, onchainId: original.onchainId }));
      } catch { /* Confirmation and delayed indexing stay separate. */ }
    }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setRow(null); setClaim(null); setAvailability(null); setError(""); setBusy(false); setIndexed(false); setManualId("");
    if (!authenticated) return;
    void (async () => {
      try {
        const info = await readJson("/api/sources/sponsor");
        if (epoch !== generation.current) return;
        setAvailability(info);
        let saved: string | null = null;
        try { saved = storageKey ? localStorage.getItem(storageKey) : null; } catch { /* Manual ID recovery stays available. */ }
        if (saved) {
          try { await inspect(saved, epoch); }
          catch { if (epoch === generation.current) setError(copy.savedRecoveryUnavailable); }
        }
        if (claimId) {
          const body = await readJson(`/api/source-claims?claimId=${claimId}`);
          if (epoch !== generation.current) return;
          if (body.claim?.ownerWallet !== owner) throw new Error(copy.verifyConnectedWallet);
          setClaim(body.claim);
          // The server's latest owner-bound original also recovers a renewal whose response was lost.
          try {
            const existing = await readJson(`/api/sources/sponsor?claimId=${claimId}`);
            if (epoch !== generation.current) return;
            const original = checkedOriginal(existing.original);
            if (original.claimId !== claimId) throw new Error(copy.originalClaimMismatch);
            setRow(original); setManualId(original.id);
            if (storageKey) try { localStorage.setItem(storageKey, original.id); } catch { /* Retain manual recovery. */ }
          } catch { /* No prior original may exist yet. Prepare is idempotent server-side. */ }
        }
      } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.originalUnavailable); }
    })();
    return () => { generation.current = epoch + 1; };
  // Reading is bound to the current wallet/session/network generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, session?.address, wallet.chainId, claimId, authenticated, storageKey]);
  async function prepare(replacesRequestId?: `0x${string}`) {
    if (!claim || !authenticated || busy) return;
    if (replacesRequestId && row && Date.now() < (row.deadline + 1) * 1000) {
      setError(copy.waitForExpiry); return;
    }
    const epoch = generation.current; setBusy(true); setError("");
    try {
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "prepare", claimId: claim.id, fetchPrice: Number(price), ...(replacesRequestId ? { replacesRequestId } : {}) }) });
      if (epoch !== generation.current) return;
      const original = checkedOriginal(body.original); setRow(original); setManualId(original.id);
      if (storageKey) try { localStorage.setItem(storageKey, original.id); } catch { setError(copy.saveRequestBeforeSigning); }
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.preparationUnavailable); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function sign() {
    if (!row || row.state !== "prepared" || busy || !authenticated || attempted.current.has(row.id)) return;
    const epoch = generation.current;
    setBusy(true); setError("");
    try {
      const original = checkedOriginal(row);
      if (getBrowserRegistryVersion() !== 3 || !availability?.available || original.relayer !== availability.sponsorAddress || original.policyDigest !== availability.policyDigest || Date.now() > original.deadline * 1000) {
        setError(copy.signingAllowanceUnavailable); return;
      }
      const signature = await signTypedDataAsync({ ...registrationTypedData(original), account: original.creator });
      if (epoch !== generation.current) return;
      checkedOriginal(original);
      attempted.current.add(original.id); // A lost POST response never permits automatic resubmission.
      setAttemptedIds(new Set(attempted.current));
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "submit", id: original.id, signature }) });
      if (epoch === generation.current) setRow(checkedOriginal(body.original));
    } catch (cause) {
      if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.submissionUnknown);
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  if (!authenticated) return <div className="mt-6"><p>{copy.connectInstructions({ network: profile.label })}</p><Link className="mt-3 inline-block underline" href="/connect">{copy.connectWalletLink}</Link></div>;
  return <section className="mt-6 space-y-4" aria-label={copy.formLabel}>
    {error && <p role="alert" className="break-words text-sm text-seal">{error}</p>}
    {!availability?.available && <p className="text-sm text-ink-2">{copy.sponsorshipUnavailable}</p>}
    {!row && availability?.available && (claim ? <div className="space-y-3">
      <p className="break-all text-sm">{copy.verifiedFeed({ feedUrl: claim.rssUrl || claim.canonicalUrl })}</p>
      <label className="block text-sm">{copy.readPriceLabel}<input className="mt-1 block w-full border border-line bg-paper p-2" type="number" min="0" max="1000000" step="0.001" value={price} onChange={event => setPrice(event.target.value)} disabled={busy} /></label>
      <button className="border border-ink px-4 py-2" disabled={busy || !Number.isFinite(Number(price)) || Number(price) < 0} onClick={() => void prepare()}>{copy.prepareRegistrationButton}</button>
    </div> : <p className="text-sm">{copy.verifyFeedInstructions}<Link className="underline" href="/claim-source">{copy.verifySourceLink}</Link></p>)}
    {row && <div className="space-y-3 border border-line bg-paper-2 p-4">
      <h2 className="font-display text-xl">{indexed ? copy.indexedHeading : labels[row.state]}</h2>
      <p className="break-all text-sm">{copy.source({ sourceUrl: row.canonicalUrl })}</p>
      <p className="break-all text-sm">{copy.creatorWallet({ wallet: row.creator })}</p>
      <div className="space-y-1 text-sm"><p>{copy.authorRewardsLabel}</p>{row.params.authors.map((author, index) =>
        <p className="break-all" key={`${author.wallet}:${index}`}>{author.wallet}: {(author.basisPoints / 100).toFixed(2)}%</p>)}</div>
      <p className="text-sm">{copy.readPrice({ priceUsdc: formatUnits(BigInt(row.params.fetchPriceUsdc6), 6) })}</p>
      <p className="break-all text-sm">{copy.contentIdentifier({ contentId: row.params.contentCid || copy.retainedFeedContent })}</p>
      <p className="break-all text-sm">{copy.tags({ tags: row.params.tags || copy.noTags })}</p>
      <p className="break-all text-sm">{copy.networkRegistry({ network: profile.label, registry: row.registryAddress })}</p>
      <p className="break-all text-sm">{copy.gasSponsor({ wallet: row.relayer })}</p>
      <p className="text-sm">{copy.authorizationExpiry({ expiresAt: new Date(row.deadline * 1000).toISOString() })}</p>
      <p className="text-sm">{copy.gasReservation({ gasUsdc: formatUnits(BigInt(row.reservedWei), 18) })}</p>
      <label className="block text-xs">{copy.originalRequestLabel}<input className="mt-1 w-full border border-line bg-paper p-2 font-mono text-xs" readOnly value={row.id} /></label>
      {row.transactionHash && <a className="block break-all text-xs underline" href={`${profile.explorerUrl}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">{copy.originalTransaction({ transactionHash: row.transactionHash })}</a>}
      {row.actualGasWei !== undefined && <p className="text-sm">{copy.confirmedGasCost({ gasUsdc: formatUnits(BigInt(row.actualGasWei), 18) })}</p>}
      {row.state === "prepared" && <button className="border border-ink px-4 py-2" disabled={busy || attemptedIds.has(row.id) || !availability?.available} onClick={() => void sign()}>{copy.signRegistrationButton}</button>}
      {row.state === "expired" && claim && availability?.available && <div className="space-y-2"><p className="text-sm">{copy.expiredRequestExplanation}</p>
        <button className="border border-ink px-4 py-2" disabled={busy} onClick={() => void prepare(row.id)}>{copy.prepareReplacementButton}</button></div>}
      <button className="block text-sm underline" disabled={busy} onClick={() => void inspect(row.id).catch(() => setError(copy.requestRecoveryUnavailable))}>{copy.inspectOriginalButton}</button>
      <p className="text-xs text-ink-2">{copy.lostResponseExplanation}</p>
      {indexed && <Link className="inline-block text-sm underline" href={`/claim-source?claimId=${row.claimId}`}>{copy.earningsPolicyLink}</Link>}
    </div>}
    {!row && <div className="space-y-2"><label className="block text-sm">{copy.recoverRequestLabel}<input className="mt-1 block w-full border border-line bg-paper p-2 font-mono text-xs" value={manualId} onChange={event => setManualId(event.target.value)} /></label>
      <button className="text-sm underline" disabled={busy || !/^0x[0-9a-f]{64}$/.test(manualId)} onClick={() => void inspect(manualId).catch(() => setError(copy.idRecoveryUnavailable))}>{copy.inspectSavedButton}</button></div>}
    {!row && <Link className="inline-block text-sm underline" href="/register">{copy.walletFundedRegistrationLink}</Link>}
  </section>;
}
