"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { canonicalSourceUrl, sourceClaimSchema, type SourceClaim, type SourceClaimMode } from "@/lib/sources/public-source-claim";
import { registrationTarget } from "@/lib/registration-return";
import { fmtUsdc } from "./phase-style";
import { claimRequest } from "./public-source-claim-api";
import { ClaimTime } from "./public-source-claim-status";

interface Listing { id: string; name: string; url: string; rssUrl?: string; walletAddress: string; onchainId?: string; fetchPrice: number }
const modes: { value: SourceClaimMode; title: string; detail: string }[] = [
  { value: "free", title: "Free", detail: "Free reads with no creator rewards." },
  { value: "citation-only", title: "Citation rewards", detail: "Free reads. Qualified citations may earn budgeted rewards after activation." },
  { value: "paid", title: "Paid reads", detail: "Charge the positive on-chain read toll. Qualified citations may receive separate rewards." },
];
function sameUrl(a: string | undefined, b: string) { try { return !!a && canonicalSourceUrl(a) === b; } catch { return false; } }

export function PublicSourceClaimPolicy({ claim, name, enabled, controlFresh, onChanged, onReload }: {
  claim: SourceClaim; name?: string; enabled: boolean; controlFresh: boolean; onChanged: (claim: SourceClaim) => void; onReload: () => void;
}) {
  const wallet = useAccount(), { session } = useSiweAuth();
  const owner = session?.address.toLowerCase(), profile = browserPaymentProfile();
  const identity = `${owner}:${wallet.address}:${wallet.chainId}:${claim.id}:${claim.revision}`;
  const [mode, setMode] = useState<SourceClaimMode>(claim.mode);
  const [consent, setConsent] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsReady, setListingsReady] = useState(false);
  const [selected, setSelected] = useState(claim.linkedSourceId ?? "");
  const [newPrice, setNewPrice] = useState("0.016");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const latest = useRef({ identity, enabled }), mounted = useRef(true), busy = useRef(false);
  useLayoutEffect(() => { latest.current = { identity, enabled }; }, [identity, enabled]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const loadListings = useCallback(async () => {
    const captured = identity;
    try {
      const data = await claimRequest("/api/sources");
      if (!mounted.current || latest.current.identity !== captured) return;
      if (!Array.isArray(data.sources)) throw new Error("Your listings are unavailable.");
      const eligible = (data.sources as Listing[]).filter(source => typeof source.walletAddress === "string" && source.walletAddress.toLowerCase() === claim.ownerWallet && !!source.onchainId && (sameUrl(source.url, claim.canonicalUrl) || sameUrl(source.rssUrl, claim.canonicalUrl) || !!claim.rssUrl && sameUrl(source.rssUrl, claim.rssUrl)));
      setListings(eligible); setListingsReady(true);
    } catch (error) { if (mounted.current && latest.current.identity === captured) setMessage(error instanceof Error ? error.message : "Could not load listings."); }
  }, [identity, claim.ownerWallet, claim.canonicalUrl, claim.rssUrl]);
  useEffect(() => { const timer = window.setTimeout(() => void loadListings(), 0); return () => window.clearTimeout(timer); }, [loadListings]);
  const listing = listings.find(source => source.id === (claim.linkedSourceId ?? selected));
  const feeMatches = !!listing && (mode === "paid" ? listing.fetchPrice > 0 : listing.fetchPrice === 0);
  const changed = mode !== claim.mode;
  const earning = mode !== "free";
  const canActivate = enabled && !working && (mode === "free" || controlFresh && !!claim.linkedSourceId && feeMatches && consent);
  const price = mode === "paid" ? Number(newPrice) : 0;
  const validNewPrice = Number.isFinite(price) && price >= 0 && (mode !== "paid" || price > 0) && Number.isSafeInteger(Math.round(price * 1_000_000)) && Math.round(price * 1_000_000) / 1_000_000 === price;
  const registrationHref = validNewPrice ? registrationTarget({ url: claim.canonicalUrl, ...(claim.rssUrl ? { rssUrl: claim.rssUrl } : {}), name: name ?? new URL(claim.canonicalUrl).hostname, sourceClaimId: claim.id, fetchPrice: price, owner: claim.ownerWallet }) : null;
  const mutate = async (action: "link" | "policy") => {
    if (busy.current || !enabled || owner !== claim.ownerWallet || wallet.address?.toLowerCase() !== owner || wallet.chainId !== profile.chainId) return;
    if (action === "link" && (!selected || !controlFresh) || action === "policy" && !canActivate) return;
    const captured = identity;
    busy.current = true; setWorking(true); setMessage("");
    const current = () => mounted.current && latest.current.identity === captured && latest.current.enabled;
    try {
      const data = await claimRequest(`/api/source-claims/${encodeURIComponent(claim.id)}/${action}`, { expectedRevision: claim.revision, ...(action === "link" ? { sourceId: selected } : { mode, distributionPermission: earning && consent }) });
      if (!current()) return;
      const next = sourceClaimSchema.parse(data.claim);
      if (next.ownerWallet !== claim.ownerWallet || next.id !== claim.id || next.network !== profile.networkId) throw new Error("The saved policy does not match this source owner and network. Reload its current status.");
      onChanged(next);
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "The update could not be confirmed. Reload current status before retrying."); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  };
  return <div className="space-y-5 border-t border-paid/30 pt-5">
    <div>
      <h3 className="font-display text-2xl">3. Choose and activate a policy</h3>
      <p className="mt-2 text-sm leading-relaxed text-ink-2">Saved policy: <strong>{modes.find(value => value.value === claim.mode)?.title}</strong>. Effective for eligible new uses from <ClaimTime value={claim.effectiveAt} />. Verification does not collect past rewards or charge for earlier free reads.</p>
    </div>
    <fieldset disabled={working || !enabled} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Requested policy</legend>
      {modes.map(option => <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-3 border border-line bg-paper p-3">
        <input type="radio" name="source-claim-mode" value={option.value} checked={mode === option.value} onChange={() => { setMode(option.value); setConsent(false); }} className="mt-1" />
        <span className="text-sm"><strong>{option.title}</strong><span className="mt-1 block text-ink-2">{option.detail}</span></span>
      </label>)}
    </fieldset>
    <div className="space-y-3">
      <h4 className="font-display text-xl">Your SourceRegistry listing</h4>
      <p className="text-sm text-ink-2">Earnings require a confirmed, indexed listing created by this wallet. Connecting a listing keeps this claim&apos;s current policy until you explicitly activate a new one.</p>
      {claim.linkedSourceId ? <p className="break-all text-sm">Connected listing: <Link href={`/creator/${encodeURIComponent(claim.linkedSourceId)}`} className="underline">{listing?.name ?? claim.linkedSourceId}</Link></p> : listings.length ? <>
        <label htmlFor="claim-existing-listing" className="block text-sm">Existing listing for this source</label>
        <select id="claim-existing-listing" value={selected} onChange={event => setSelected(event.target.value)} disabled={!enabled || working} className="min-h-11 w-full min-w-0 border border-line bg-paper px-3 text-sm"><option value="">Choose a listing</option>{listings.map(source => <option key={source.id} value={source.id}>{source.name} · ${fmtUsdc(source.fetchPrice)} per read</option>)}</select>
        <button type="button" disabled={!selected || working || !enabled || !controlFresh} onClick={() => void mutate("link")} className="min-h-11 border border-ink px-4 text-sm disabled:opacity-50">Connect existing listing</button>
      </> : <p role="status" className="text-sm text-ink-2">{listingsReady ? "No matching indexed listing is available for this wallet." : "Loading your matching listings…"}</p>}
      {listing && <p className="text-sm">On-chain price per read: <strong>${fmtUsdc(listing.fetchPrice)} USDC</strong>. Citation rewards are separately budgeted and require qualifying evidence; their amount is not guaranteed.</p>}
      {!claim.linkedSourceId && <div className="space-y-3 border border-line bg-paper p-4">
        {mode === "paid" && <><label htmlFor="claim-new-price" className="block text-sm">Price for a new listing (USDC per read)</label><input id="claim-new-price" type="number" min="0.000001" step="0.000001" value={newPrice} onChange={event => setNewPrice(event.target.value)} disabled={!enabled || working} className="min-h-11 w-full border border-line bg-paper-2 px-3 text-sm" /></>}
        <p className="text-sm">New listing read price: {validNewPrice ? `$${fmtUsdc(price)} USDC` : "enter an exact positive USDC amount with at most six decimal places"}. Registration opens a separate review and may require a wallet transaction and native gas. It does not activate earnings.</p>
        {enabled && controlFresh && registrationHref && <Link href={registrationHref} className="inline-block min-h-11 py-2 text-sm underline">Register a new listing for this claim</Link>}
      </div>}
      <button type="button" disabled={working} onClick={() => void loadListings()} className="min-h-11 text-sm underline">Refresh indexed listings</button>
      {earning && claim.linkedSourceId && listingsReady && !feeMatches && <p role="status" className="text-sm text-seal">{mode === "citation-only" ? "Citation-only mode requires an on-chain read price of zero." : "Paid mode requires a positive on-chain read price."} Review your listing&apos;s price, then refresh here. A policy update does not change its on-chain toll.</p>}
    </div>
    {earning && <label className="flex min-h-11 items-start gap-3 border border-line bg-paper p-3 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!enabled || working} className="mt-1" /><span>I have the rights to distribute the registered content through Keryx and receive payments for it. Website control alone does not establish those rights.</span></label>}
    <p className="text-sm text-ink-2">{mode === "free" ? "This policy disables creator rewards for this claim. Public reads remain free." : mode === "citation-only" ? "Future reads remain free. Only new qualified citations after activation can earn rewards." : "Only new selected paid reads through this registered listing can incur its toll after activation. Public references and historical free receipts stay free."}</p>
    <button type="button" onClick={() => void mutate("policy")} disabled={!canActivate} className="min-h-11 border border-ink bg-seal px-4 py-2.5 text-sm text-paper disabled:opacity-50">{working ? "Saving policy…" : mode === "free" ? "Keep this claim free" : `Activate ${mode === "paid" ? "paid reads" : "citation rewards"}`}</button>
    {claim.mode !== "free" && !changed && enabled && controlFresh && <p role="status" className="text-sm">This earning policy is saved. New qualified uses may earn while control proof, permission and live registry authority remain valid; activation does not guarantee selection or settlement.</p>}
    {message && <div role="status" className="space-y-2 text-sm text-seal"><p>{message}</p><button type="button" onClick={onReload} className="min-h-11 underline">Reload current claim status</button></div>}
  </div>;
}
