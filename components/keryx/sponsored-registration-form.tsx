"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { formatUnits, keccak256, toBytes } from "viem";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile, browserRegistryAddress } from "@/lib/browser-payment-profile";
import { registrationId, confirmsIndex } from "@/lib/sources/registration-status";
import { registrationIntentDigest, registrationTypedData, sponsoredRegistrationSchema, type SponsoredRegistration } from "@/lib/sources/registration-sponsor-protocol";
import { getBrowserRegistryVersion } from "@/lib/registry/registry-version";

interface Availability { available: boolean; sponsorAddress?: string; policyDigest?: string; maxGasWei?: string }
const labels: Record<SponsoredRegistration["state"], string> = { prepared: "Review the prepared registration", signing: "Sponsor submission outcome unknown",
  submitted: "Original transaction submitted: confirmation pending", confirmed: "Registration confirmed: indexing pending",
  reverted: "Registration reverted", expired: "Unsigned registration expired" };
export function SponsoredRegistrationForm({ claimId }: { claimId?: string }) {
  const wallet = useAccount(), { session } = useSiweAuth(), { signTypedDataAsync } = useSignTypedData();
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
    if (!response.ok) throw new Error(body.error || "Registration request unavailable");
    return body;
  }
  function checkedOriginal(value: unknown) {
    const original = sponsoredRegistrationSchema.parse(value), identity = current.current;
    if (identity.chainId !== profile.chainId || original.creator !== identity.address?.toLowerCase() || original.creator !== identity.session?.toLowerCase() ||
      original.chainId !== profile.chainId || original.registryAddress !== registry.toLowerCase() ||
      original.params.payoutWallet !== original.creator || original.onchainId !== registrationId(original.creator, original.params.urlHash) ||
      original.params.urlHash !== keccak256(toBytes(original.canonicalUrl)) || original.id !== registrationIntentDigest(original))
      throw new Error("Original registration belongs to another wallet or registry");
    return original;
  }
  async function inspect(id: string, epoch = generation.current) {
    const body = await readJson(`/api/sources/sponsor?id=${encodeURIComponent(id)}`);
    if (epoch !== generation.current) return;
    const original = checkedOriginal(body.original); setRow(original); setManualId(original.id);
    if (body.recoveryUnavailable) setError("Original recovery is unavailable. Keep this request; do not register again.");
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
          catch { if (epoch === generation.current) setError("Saved original recovery is unavailable; retain its ID."); }
        }
        if (claimId) {
          const body = await readJson(`/api/source-claims?claimId=${claimId}`);
          if (epoch !== generation.current) return;
          if (body.claim?.ownerWallet !== owner) throw new Error("Verify this source with the connected wallet first");
          setClaim(body.claim);
          // The server's latest owner-bound original also recovers a renewal whose response was lost.
          try {
            const existing = await readJson(`/api/sources/sponsor?claimId=${claimId}`);
            if (epoch !== generation.current) return;
            const original = checkedOriginal(existing.original);
            if (original.claimId !== claimId) throw new Error("Original registration belongs to another source claim");
            setRow(original); setManualId(original.id);
            if (storageKey) try { localStorage.setItem(storageKey, original.id); } catch { /* Retain manual recovery. */ }
          } catch { /* No prior original may exist yet. Prepare is idempotent server-side. */ }
        }
      } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : "Original registration unavailable"); }
    })();
    return () => { generation.current = epoch + 1; };
  // Reading is bound to the current wallet/session/network generation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, session?.address, wallet.chainId, claimId, authenticated, storageKey]);
  async function prepare(replacesRequestId?: `0x${string}`) {
    if (!claim || !authenticated || busy) return;
    if (replacesRequestId && row && Date.now() < (row.deadline + 1) * 1000) {
      setError("Wait until the original unsigned request has conclusively expired."); return;
    }
    const epoch = generation.current; setBusy(true); setError("");
    try {
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "prepare", claimId: claim.id, fetchPrice: Number(price), ...(replacesRequestId ? { replacesRequestId } : {}) }) });
      if (epoch !== generation.current) return;
      const original = checkedOriginal(body.original); setRow(original); setManualId(original.id);
      if (storageKey) try { localStorage.setItem(storageKey, original.id); } catch { setError("Save the original request ID below before signing. Browser recovery storage is unavailable."); }
    } catch (cause) { if (epoch === generation.current) setError(cause instanceof Error ? cause.message : "Preparation unavailable"); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function sign() {
    if (!row || row.state !== "prepared" || busy || !authenticated || attempted.current.has(row.id)) return;
    const original = checkedOriginal(row), epoch = generation.current;
    if (getBrowserRegistryVersion() !== 3 || !availability?.available || original.relayer !== availability.sponsorAddress || original.policyDigest !== availability.policyDigest || Date.now() > original.deadline * 1000) {
      setError("This original has no current signing allowance. Inspect its status; do not register again."); return;
    }
    setBusy(true); setError("");
    try {
      const signature = await signTypedDataAsync({ ...registrationTypedData(original), account: original.creator });
      if (epoch !== generation.current) return;
      checkedOriginal(original);
      attempted.current.add(original.id); // A lost POST response never permits automatic resubmission.
      setAttemptedIds(new Set(attempted.current));
      const body = await readJson("/api/sources/sponsor", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "submit", id: original.id, signature }) });
      if (epoch === generation.current) setRow(checkedOriginal(body.original));
    } catch (cause) {
      if (epoch === generation.current) setError(cause instanceof Error ? cause.message : "Submission unknown. Inspect the original request.");
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  if (!authenticated) return <div className="mt-6"><p>Connect and sign in with your creator wallet on {profile.label}.</p><Link className="mt-3 inline-block underline" href="/connect">Connect wallet ▸</Link></div>;
  return <section className="mt-6 space-y-4" aria-label="Sponsored source registration">
    {error && <p role="alert" className="break-words text-sm text-seal">{error}</p>}
    {!availability?.available && <p className="text-sm text-ink-2">Registration gas sponsorship is currently unavailable for this wallet. Existing requests can still be inspected.</p>}
    {!row && availability?.available && (claim ? <div className="space-y-3">
      <p className="break-all text-sm">Verified feed: {claim.rssUrl || claim.canonicalUrl}</p>
      <label className="block text-sm">Price per read (USDC)<input className="mt-1 block w-full border border-line bg-paper p-2" type="number" min="0" max="1000000" step="0.001" value={price} onChange={event => setPrice(event.target.value)} disabled={busy} /></label>
      <button className="border border-ink px-4 py-2" disabled={busy || !Number.isFinite(Number(price)) || Number(price) < 0} onClick={() => void prepare()}>Prepare sponsored registration</button>
    </div> : <p className="text-sm">Prove control of your exact feed first. <Link className="underline" href="/claim-source">Verify my source ▸</Link></p>)}
    {row && <div className="space-y-3 border border-line bg-paper-2 p-4">
      <h2 className="font-display text-xl">{indexed ? "Registration confirmed and indexed" : labels[row.state]}</h2>
      <p className="break-all text-sm">Source: {row.canonicalUrl}</p>
      <p className="break-all text-sm">Creator and payout wallet: {row.creator}</p>
      <p className="text-sm">Price per read: {formatUnits(BigInt(row.params.fetchPriceUsdc6), 6)} USDC</p>
      <p className="text-sm">Keryx gas reservation: up to {formatUnits(BigInt(row.reservedWei), 18)} USDC. This is separate from creator earnings.</p>
      <label className="block text-xs">Original request<input className="mt-1 w-full border border-line bg-paper p-2 font-mono text-xs" readOnly value={row.id} /></label>
      {row.transactionHash && <a className="block break-all text-xs underline" href={`${profile.explorerUrl}/tx/${row.transactionHash}`} target="_blank" rel="noreferrer">Original registration transaction: {row.transactionHash}</a>}
      {row.actualGasWei !== undefined && <p className="text-sm">Confirmed sponsor gas cost: {formatUnits(BigInt(row.actualGasWei), 18)} USDC</p>}
      {row.state === "prepared" && <button className="border border-ink px-4 py-2" disabled={busy || attemptedIds.has(row.id) || !availability?.available} onClick={() => void sign()}>Sign reviewed registration</button>}
      {row.state === "expired" && claim && availability?.available && <div className="space-y-2"><p className="text-sm">This original expired before sponsor signing. A new reviewed request uses another sponsorship attempt and retains the original history.</p>
        <button className="border border-ink px-4 py-2" disabled={busy} onClick={() => void prepare(row.id)}>Prepare new unsigned request</button></div>}
      <button className="block text-sm underline" disabled={busy} onClick={() => void inspect(row.id).catch(() => setError("Original recovery unavailable; retain this request."))}>Inspect original registration</button>
      <p className="text-xs text-ink-2">A lost response retains this attempt. Inspection sends no new transaction. Registration alone does not activate creator earnings.</p>
      {indexed && <Link className="inline-block text-sm underline" href={`/claim-source?claimId=${row.claimId}`}>Review this source&apos;s earnings policy ▸</Link>}
    </div>}
    {!row && <div className="space-y-2"><label className="block text-sm">Recover original request<input className="mt-1 block w-full border border-line bg-paper p-2 font-mono text-xs" value={manualId} onChange={event => setManualId(event.target.value)} /></label>
      <button className="text-sm underline" disabled={busy || !/^0x[0-9a-f]{64}$/.test(manualId)} onClick={() => void inspect(manualId).catch(() => setError("Original recovery unavailable; retain its ID."))}>Inspect saved request</button></div>}
    {!row && <Link className="inline-block text-sm underline" href="/register">Wallet-funded registration ▸</Link>}
  </section>;
}
