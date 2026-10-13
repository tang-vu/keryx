"use client";
import { SigningAmount } from "./signing-amount";
import { DisplayTime } from "./display-time";
import { formatUnits } from "viem";
import { formatAmount, formatNumber } from "@/lib/i18n/format";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount, useConfig, useSignTypedData } from "wagmi";
import { getConnection } from "wagmi/actions";
import { keccak256, toBytes } from "viem";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile, browserRegistryAddress } from "@/lib/browser-payment-profile";
import { registrationId, confirmsIndex } from "@/lib/sources/registration-status";
import { registrationIntentDigest, registrationTypedData, sponsoredRegistrationSchema, type SponsoredRegistration } from "@/lib/sources/registration-sponsor-protocol";
import { getBrowserRegistryVersion } from "@/lib/registry/registry-version";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";
import { registrationConnectHref, registrationTarget } from "@/lib/registration-return";

interface Availability { available: boolean; reservedGasAvailable?: boolean; reason?: string; sponsorAddress?: string; policyDigest?: string; maxGasWei?: string; publisherOrigins?: string[] }
const labels: Record<SponsoredRegistration["state"], string> = copy.stateLabels;
export function SponsoredRegistrationForm({ claimId, canPrepare = true, inspectionOnly = false, initialFetchPrice = 0.016, onPriceChange, onIndexed, connectHref }: {
  claimId?: string; canPrepare?: boolean; inspectionOnly?: boolean; initialFetchPrice?: number; onPriceChange?: (price: number) => void;
  onIndexed?: (original: SponsoredRegistration) => void; connectHref?: string | null;
}) {
  const wallet = useAccount(), { session } = useSiweAuth(), { signTypedDataAsync } = useSignTypedData();
  const walletConfig = useConfig();
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [claim, setClaim] = useState<{ id: string; canonicalUrl: string; rssUrl?: string; ownerWallet: string } | null>(null);
  const [row, setRow] = useState<SponsoredRegistration | null>(null), [error, setError] = useState("");
  const [price, setPrice] = useState(String(initialFetchPrice)), [busy, setBusy] = useState(false), [indexed, setIndexed] = useState(false);
  const [reviewMismatch, setReviewMismatch] = useState(false);
  const [manualId, setManualId] = useState("");
  const current = useRef({ address: wallet.address, session: session?.address, chainId: wallet.chainId });
  useLayoutEffect(() => {
    current.current = { address: wallet.address, session: session?.address, chainId: wallet.chainId };
  }, [wallet.address, session?.address, wallet.chainId]);
  const profile = browserPaymentProfile(), registry = browserRegistryAddress(), owner = wallet.address?.toLowerCase();
  const authenticated = Boolean(owner && session?.address.toLowerCase() === owner && wallet.chainId === profile.chainId);
  const canExecuteOriginal = !!row && !!availability && row.relayer === availability.sponsorAddress && row.policyDigest === availability.policyDigest &&
    (availability.available === true || availability.reservedGasAvailable === true);
  const storageKey = owner ? `keryx:registration-sponsor:${profile.chainId}:${registry.toLowerCase()}:${owner}:${claimId || "latest"}` : null;
  const generation = useRef(0), attempted = useRef(new Set<string>());
  const inspection = useRef(0);
  const activeInspection = useRef<{ epoch: number; token: number } | null>(null);
  const indexedCallback = useRef(onIndexed), reportedIndexed = useRef(new Set<string>());
  useLayoutEffect(() => { indexedCallback.current = onIndexed; }, [onIndexed]);
  useEffect(() => { if (!row && !busy) setPrice(editable => Number(editable) === initialFetchPrice ? editable : String(initialFetchPrice));
  // Preserve the raw decimal and cursor when the parent acknowledges the same numeric price.
  // Only an externally different price may replace the editable draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFetchPrice]);
  const validPrice = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(price) && Number(price) <= 1_000_000 && Number.isSafeInteger(Math.round(Number(price) * 1_000_000)) && Math.round(Number(price) * 1_000_000) / 1_000_000 === Number(price);
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
    if (claimId && original.claimId !== claimId) throw new Error(copy.originalClaimMismatch);
    return original;
  }
  async function inspect(id: string, epoch = generation.current) {
    if (activeInspection.current?.epoch === epoch) return;
    const token = ++inspection.current;
    activeInspection.current = { epoch, token };
    try {
      const body = await readJson(`/api/sources/sponsor?id=${encodeURIComponent(id)}`);
      if (epoch !== generation.current || token !== inspection.current) return;
      const original = checkedOriginal(body.original); setRow(original); setManualId(original.id);
      if (body.recoveryUnavailable) setError(copy.recoveryUnavailable);
      if (original.state === "confirmed") {
        try {
          const listing = await readJson(`/api/creator/${encodeURIComponent(original.sourceId)}/listing`);
          if (epoch === generation.current && token === inspection.current) {
            const matched = confirmsIndex(listing, { creator: original.creator, registry: original.registryAddress, onchainId: original.onchainId });
            setIndexed(matched);
            if (matched && !reportedIndexed.current.has(original.id)) { reportedIndexed.current.add(original.id); indexedCallback.current?.(original); }
          }
        } catch { /* Confirmation and delayed indexing stay separate. */ }
      }
    } finally { if (activeInspection.current?.token === token) activeInspection.current = null; }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    setRow(null); setClaim(null); setAvailability(null); setError(""); setBusy(false); setIndexed(false); setManualId(""); setReviewMismatch(false);
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
  useEffect(() => {
    if (!row || busy || indexed || !["signing", "submitted", "confirmed"].includes(row.state)) return;
    const epoch = generation.current, id = row.id;
    const first = window.setTimeout(() => void inspect(id, epoch).catch(() => {}), 0);
    const timer = window.setInterval(() => void inspect(id, epoch).catch(() => {}), 3000);
    return () => { window.clearTimeout(first); window.clearInterval(timer); };
  // Inspection never signs, broadcasts, resumes or prepares a replacement.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.state, indexed, busy]);
  async function prepare(replacesRequestId?: `0x${string}`) {
    if (inspectionOnly || !claim || !canPrepare || !availability?.available || !authenticated || busy || !validPrice) return;
    if (replacesRequestId && row?.state === "expired" && Date.now() < (row.deadline + 1) * 1000) {
      setError(copy.waitForExpiry); return;
    }
    const epoch = generation.current; inspection.current++; setBusy(true); setError("");
    try {
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "prepare", claimId: claim.id, fetchPrice: Number(price), ...(replacesRequestId ? { replacesRequestId } : {}) }) });
      if (epoch !== generation.current) return;
      const original = checkedOriginal(body.original);
      setRow(original); setManualId(original.id);
      if (storageKey) try { localStorage.setItem(storageKey, original.id); } catch { setError(copy.saveRequestBeforeSigning); }
      if (original.canonicalUrl !== claim.canonicalUrl || original.rssUrl !== claim.rssUrl || original.params.fetchPriceUsdc6 !== String(Math.round(Number(price) * 1_000_000))) { setReviewMismatch(true); throw new Error(copy.preparedTermsMismatch); }
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.preparationUnavailable); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function sign() {
    if (inspectionOnly || !row || row.state !== "prepared" || busy || reviewMismatch || !authenticated || attempted.current.has(row.id)) return;
    const epoch = generation.current;
    inspection.current++;
    setBusy(true); setError("");
    try {
      const original = checkedOriginal(row);
      if (getBrowserRegistryVersion() !== 3 || !canExecuteOriginal || Date.now() > original.deadline * 1000) {
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
  async function resume() {
    if (inspectionOnly || !row || !["signing", "submitted"].includes(row.state) || busy || !authenticated || !canExecuteOriginal) return;
    const epoch = generation.current; inspection.current++; setBusy(true); setError("");
    try {
      const original = checkedOriginal(row);
      if (Date.now() > original.deadline * 1000) { setError(copy.signingAllowanceUnavailable); return; }
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "resume", id: original.id }) });
      if (epoch === generation.current) setRow(checkedOriginal(body.original));
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.submissionUnknown); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function resolveExpired() {
    if (inspectionOnly || !row || !["signing", "submitted"].includes(row.state) || busy || !authenticated || !canExecuteOriginal) return;
    const epoch = generation.current; inspection.current++; setBusy(true); setError("");
    try {
      const original = checkedOriginal(row);
      if (Date.now() <= original.deadline * 1000) { setError(copy.waitForExpiry); return; }
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "resolveExpired", id: original.id }) });
      if (epoch === generation.current) setRow(checkedOriginal(body.original));
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : copy.submissionUnknown); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  const returnDraft = { sourceClaimId: claimId, fetchPrice: Number(price), owner, chainId: profile.chainId };
  const signInHref = connectHref ?? registrationConnectHref(returnDraft);
  if (!authenticated) return <div className="mt-6"><p>{copy.connectInstructions({ network: profile.label })}</p>{signInHref && <Link className="mt-3 inline-block underline" href={signInHref}>{copy.connectWalletLink}</Link>}</div>;
  return <section className="mt-6 space-y-4" aria-label={copy.formLabel}>
    {error && <p role="alert" className="break-words text-sm text-seal">{error}</p>}
    {!inspectionOnly && !availability?.available && <p className="text-sm text-ink-2">{availability?.reason && /fund|balance|exhaust/.test(availability.reason) ? copy.sponsorshipFundsUnavailable : copy.sponsorshipUnavailable}</p>}
    {!inspectionOnly && availability?.publisherOrigins?.length && <p className="text-sm text-ink-2">{copy.publisherScope({ publishers: availability.publisherOrigins.join(", ") })}</p>}
    {!inspectionOnly && !row && availability?.available && (claim && canPrepare ? <div className="space-y-3">
      <p className="break-all text-sm">{copy.verifiedFeed({ feedUrl: claim.rssUrl || claim.canonicalUrl })}</p>
      <label className="block text-sm">{copy.readPriceLabel}<input className="mt-1 block w-full border border-line bg-paper p-2" type="number" min="0" max="1000000" step="0.000001" value={price} onChange={event => {
        const next = event.target.value; setPrice(next);
        if (/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(next) && Number.isSafeInteger(Math.round(Number(next) * 1_000_000)) && Math.round(Number(next) * 1_000_000) / 1_000_000 === Number(next)) onPriceChange?.(Number(next));
      }} disabled={busy} /></label>
      <button className="min-h-11 border border-ink px-4 py-2" disabled={busy || !validPrice} onClick={() => void prepare()}>{copy.prepareRegistrationButton}</button>
    </div> : <p className="text-sm">{copy.verifyFeedInstructions}<Link className="underline" href="/claim-source">{copy.verifySourceLink}</Link></p>)}
    {row && <div className="space-y-3 border border-line bg-paper-2 p-4">
      <h2 className="font-display text-xl">{indexed ? copy.indexedHeading : labels[row.state]}</h2>
      <p className="break-all text-sm">{copy.source({ sourceUrl: row.canonicalUrl })}</p>
      <p className="break-all text-sm">{copy.creatorWallet({ wallet: row.creator })}</p>
      <div className="space-y-1 text-sm"><p>{copy.authorRewardsLabel}</p>{row.params.authors.map((author, index) =>
        <p className="break-all" key={`${author.wallet}:${index}`}>{author.wallet}: {formatNumber((author.basisPoints / 100), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</p>)}</div>
      <p className="text-xs"><SigningAmount micros={row.params.fetchPriceUsdc6} /></p>
      <p className="text-sm">{copy.readPrice({ priceUsdc: formatAmount(BigInt(row.params.fetchPriceUsdc6), { minimumFractionDigits: 6, useGrouping: false }) })}</p>
      <p className="break-all text-sm">{copy.contentIdentifier({ contentId: row.params.contentCid || copy.retainedFeedContent })}</p>
      <p className="break-all text-sm">{copy.tags({ tags: row.params.tags || copy.noTags })}</p>
      <p className="break-all text-sm">{copy.networkRegistry({ network: profile.label, registry: row.registryAddress })}</p>
      <p className="break-all text-sm">{copy.gasSponsor({ wallet: row.relayer })}</p>
      <p className="text-sm">{copy.authorizationExpiry({ expiresAt: "" })}<DisplayTime value={row.deadline * 1000} /></p>
      <p className="text-sm">{copy.gasReservation({ gasUsdc: formatUnits(BigInt(row.reservedWei), 18) })}</p>
      <label className="block text-xs">{copy.originalRequestLabel}<input className="mt-1 w-full border border-line bg-paper p-2 font-mono text-xs" readOnly value={row.id} /></label>
      {row.transactionHash && <a className="block break-all text-xs underline" href={`${profile.explorerUrl}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">{copy.originalTransaction({ transactionHash: row.transactionHash })}</a>}
      {row.actualGasWei !== undefined && <p className="text-sm">{copy.confirmedGasCost({ gasUsdc: formatUnits(BigInt(row.actualGasWei), 18) })}</p>}
      {!inspectionOnly && row.state === "prepared" && <button className="border border-ink px-4 py-2" disabled={busy || reviewMismatch || attemptedIds.has(row.id) || !canExecuteOriginal} onClick={() => void sign()}>{copy.signRegistrationButton}</button>}
      {!inspectionOnly && ["signing", "submitted"].includes(row.state) && <div className="space-y-2"><p className="text-sm">{copy.resumeOriginalExplanation}</p>
        <button className="border border-ink px-4 py-2" disabled={busy || !canExecuteOriginal} onClick={() => void resume()}>{copy.resumeOriginalButton}</button></div>}
      {!inspectionOnly && ["signing", "submitted"].includes(row.state) && <div className="space-y-2"><p className="text-sm">{copy.resolveExpiredExplanation}</p>
        <button className="border border-ink px-4 py-2" disabled={busy || !canExecuteOriginal} onClick={() => void resolveExpired()}>{copy.resolveExpiredButton}</button></div>}
      {!inspectionOnly && ["expired", "reverted"].includes(row.state) && claim && canPrepare && availability?.available && <div className="space-y-2"><p className="text-sm">{row.state === "expired" ? copy.expiredRequestExplanation : copy.revertedRequestExplanation}</p>
        <button className="border border-ink px-4 py-2" disabled={busy} onClick={() => void prepare(row.id)}>{copy.prepareReplacementButton}</button></div>}
      <button className="block text-sm underline" disabled={busy} onClick={() => void inspect(row.id).catch(() => setError(copy.requestRecoveryUnavailable))}>{copy.inspectOriginalButton}</button>
      <p className="text-xs text-ink-2">{copy.lostResponseExplanation}</p>
      {!inspectionOnly && indexed && !onIndexed && <Link className="inline-block text-sm underline" href={`/claim-source?claimId=${row.claimId}`}>{copy.earningsPolicyLink}</Link>}
    </div>}
    {!row && <details className="border border-line p-3"><summary className="cursor-pointer text-sm">{copy.advancedRecovery}</summary><div className="mt-3 space-y-2"><label className="block text-sm">{copy.recoverRequestLabel}<input className="mt-1 block w-full border border-line bg-paper p-2 font-mono text-xs" value={manualId} onChange={event => setManualId(event.target.value)} /></label>
      <button className="min-h-11 text-sm underline" disabled={busy || !/^0x[0-9a-f]{64}$/.test(manualId)} onClick={() => void inspect(manualId).catch(() => setError(copy.idRecoveryUnavailable))}>{copy.inspectSavedButton}</button></div></details>}
    {!inspectionOnly && !row && !onIndexed && <Link className="inline-block text-sm underline" href={registrationTarget({ ...returnDraft, mode: "wallet-funded" })}>{copy.walletFundedRegistrationLink}</Link>}
  </section>;
}
