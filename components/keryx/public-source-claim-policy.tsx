"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
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
import { RegistrationSponsorLink } from "./registration-sponsor-link";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface Listing { id: string; name: string; url: string; rssUrl?: string; walletAddress: string; onchainId?: string; fetchPrice: number }
const modes: { value: SourceClaimMode; title: string; detail: string }[] = [
  { value: "free", title: uiCopy("sourceClaimPolicy.free"), detail: uiCopy("sourceClaimPolicy.freeDetail") },
  { value: "citation-only", title: uiCopy("sourceClaimPolicy.citation"), detail: uiCopy("sourceClaimPolicy.citationDetail") },
  { value: "paid", title: uiCopy("sourceClaimPolicy.paid"), detail: uiCopy("sourceClaimPolicy.paidDetail") },
];
function sameUrl(a: string | undefined, b: string) { try { return !!a && canonicalSourceUrl(a) === b; } catch { return false; } }

export function PublicSourceClaimPolicy({ claim, name, initialFetchPrice = 0.016, embedded = false, enabled, controlFresh, onChanged, onReload }: {
  claim: SourceClaim; name?: string; initialFetchPrice?: number; embedded?: boolean; enabled: boolean; controlFresh: boolean; onChanged: (claim: SourceClaim) => void; onReload: () => void;
}) {
  const wallet = useAccount(), { session } = useSiweAuth();
  const owner = session?.address.toLowerCase(), profile = browserPaymentProfile();
  const identity = `${owner}:${wallet.address}:${wallet.chainId}:${claim.id}:${claim.revision}`;
  const [mode, setMode] = useState<SourceClaimMode>(claim.mode);
  const [consent, setConsent] = useState(false);
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingsReady, setListingsReady] = useState(false);
  const [selected, setSelected] = useState(claim.linkedSourceId ?? "");
  const [newPrice, setNewPrice] = useState(String(initialFetchPrice));
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
      if (!Array.isArray(data.sources)) throw new Error(uiCopy("sourceClaimPolicy.listingsUnavailable"));
      const eligible = (data.sources as Listing[]).filter(source => typeof source.walletAddress === "string" && source.walletAddress.toLowerCase() === claim.ownerWallet && !!source.onchainId && (sameUrl(source.url, claim.canonicalUrl) || sameUrl(source.rssUrl, claim.canonicalUrl) || !!claim.rssUrl && sameUrl(source.rssUrl, claim.rssUrl)));
      setListings(eligible); setListingsReady(true);
    } catch (error) { if (mounted.current && latest.current.identity === captured) setMessage(error instanceof Error ? error.message : uiCopy("sourceClaimPolicy.loadFailed")); }
  }, [identity, claim.ownerWallet, claim.canonicalUrl, claim.rssUrl]);
  useEffect(() => { const timer = window.setTimeout(() => void loadListings(), 0); return () => window.clearTimeout(timer); }, [loadListings]);
  const listing = listings.find(source => source.id === (claim.linkedSourceId ?? selected));
  const feeMatches = !!listing && (mode === "paid" ? listing.fetchPrice > 0 : listing.fetchPrice === 0);
  const changed = mode !== claim.mode;
  const earning = mode !== "free";
  const canActivate = enabled && !working && (mode === "free" || controlFresh && !!claim.linkedSourceId && feeMatches && consent);
  const price = mode === "paid" ? Number(newPrice) : 0;
  const validNewPrice = Number.isFinite(price) && price >= 0 && (mode !== "paid" || price > 0) && Number.isSafeInteger(Math.round(price * 1_000_000)) && Math.round(price * 1_000_000) / 1_000_000 === price;
  const registrationHref = validNewPrice ? registrationTarget({ url: claim.canonicalUrl, ...(claim.rssUrl ? { rssUrl: claim.rssUrl } : {}), name: name ?? new URL(claim.canonicalUrl).hostname, sourceClaimId: claim.id, fetchPrice: price, owner: claim.ownerWallet, chainId: profile.chainId, mode: "wallet-funded" }) : null;
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
      if (next.ownerWallet !== claim.ownerWallet || next.id !== claim.id || next.network !== profile.networkId) throw new Error(uiCopy("sourceClaimPolicy.savedMismatch"));
      onChanged(next);
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : uiCopy("sourceClaimPolicy.updateUnknown")); }
    finally { busy.current = false; if (mounted.current) setWorking(false); }
  };
  return <div className="space-y-5 border-t border-paid/30 pt-5">
    <div>
      {!embedded && <h3 className="font-display text-2xl">{uiCopy("sourceClaimPolicy.title")}</h3>}
      <p className="mt-2 text-sm leading-relaxed text-ink-2">{uiRichCopy("sourceClaimPolicy.saved", { policy: <strong>{modes.find(value => value.value === claim.mode)?.title}</strong>, time: <ClaimTime value={claim.effectiveAt} /> })}</p>
    </div>
    <fieldset disabled={working || !enabled} className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">{uiCopy("sourceClaimPolicy.requested")}</legend>
      {modes.map(option => <label key={option.value} className="flex min-h-11 cursor-pointer items-start gap-3 border border-line bg-paper p-3">
        <input type="radio" name="source-claim-mode" value={option.value} checked={mode === option.value} onChange={() => { setMode(option.value); setConsent(false); }} className="mt-1" />
        <span className="text-sm"><strong>{option.title}</strong><span className="mt-1 block text-ink-2">{option.detail}</span></span>
      </label>)}
    </fieldset>
    <div className="space-y-3">
      <h4 className="font-display text-xl">{uiCopy("sourceClaimPolicy.registryListing")}</h4>
      <p className="text-sm text-ink-2">{uiCopy("sourceClaimPolicy.listingRequirement")}</p>
      {claim.linkedSourceId ? <p className="break-all text-sm">{uiRichCopy("sourceClaimPolicy.connected", { listingLink: <Link href={`/creator/${encodeURIComponent(claim.linkedSourceId)}`} className="underline">{listing?.name ?? claim.linkedSourceId}</Link> })}</p> : listings.length ? <>
        <label htmlFor="claim-existing-listing" className="block text-sm">{uiCopy("sourceClaimPolicy.existingLabel")}</label>
        <select id="claim-existing-listing" value={selected} onChange={event => setSelected(event.target.value)} disabled={!enabled || working} className="min-h-11 w-full min-w-0 border border-line bg-paper px-3 text-sm"><option value="">{uiCopy("sourceClaimPolicy.choose")}</option>{listings.map(source => <option key={source.id} value={source.id}>{uiCopy("sourceClaimPolicy.listingOption", { name: source.name, price: fmtUsdc(source.fetchPrice) })}</option>)}</select>
        <button type="button" disabled={!selected || working || !enabled || !controlFresh} onClick={() => void mutate("link")} className="min-h-11 border border-ink px-4 text-sm disabled:opacity-50">{uiCopy("sourceClaimPolicy.connect")}</button>
      </> : <p role="status" className="text-sm text-ink-2">{listingsReady ? uiCopy("sourceClaimPolicy.noMatching") : uiCopy("sourceClaimPolicy.loading")}</p>}
      {listing && <p className="text-sm">{uiRichCopy("sourceClaimPolicy.readPrice", { price: <strong>{uiCopy("sourceClaimPolicy.usdcPrice", { price: fmtUsdc(listing.fetchPrice) })}</strong> })}</p>}
      {!claim.linkedSourceId && <div className="space-y-3 border border-line bg-paper p-4">
        {mode === "paid" && <><label htmlFor="claim-new-price" className="block text-sm">{uiCopy("sourceClaimPolicy.newPriceLabel")}</label><input id="claim-new-price" type="number" min="0.000001" step="0.000001" value={newPrice} onChange={event => setNewPrice(event.target.value)} disabled={!enabled || working} className="min-h-11 w-full border border-line bg-paper-2 px-3 text-sm" /></>}
        <p className="text-sm">{validNewPrice ? uiCopy("sourceClaimPolicy.newReadPrice", { price: fmtUsdc(price) }) : uiCopy("sourceClaimPolicy.invalidReadPrice")}</p>
        {enabled && controlFresh && registrationHref && <Link href={registrationHref} className="inline-block min-h-11 py-2 text-sm underline">{uiCopy("sourceClaimPolicy.register")}</Link>}
        {enabled && controlFresh && claim.rssUrl && validNewPrice && <RegistrationSponsorLink wallet={claim.ownerWallet} claimId={claim.id} publisherUrl={claim.canonicalUrl} rssUrl={claim.rssUrl} name={name} fetchPrice={price} />}
      </div>}
      <button type="button" disabled={working} onClick={() => void loadListings()} className="min-h-11 text-sm underline">{uiCopy("sourceClaimPolicy.refresh")}</button>
      {earning && claim.linkedSourceId && listingsReady && !feeMatches && <p role="status" className="text-sm text-seal">{mode === "citation-only" ? uiCopy("sourceClaimPolicy.citationPriceMismatch") : uiCopy("sourceClaimPolicy.paidPriceMismatch")}</p>}
    </div>
    {earning && <label className="flex min-h-11 items-start gap-3 border border-line bg-paper p-3 text-sm"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} disabled={!enabled || working} className="mt-1" /><span>{uiCopy("sourceClaimPolicy.consent")}</span></label>}
    <p className="text-sm text-ink-2">{mode === "free" ? uiCopy("sourceClaimPolicy.freeNotice") : mode === "citation-only" ? uiCopy("sourceClaimPolicy.citationNotice") : uiCopy("sourceClaimPolicy.paidNotice")}</p>
    <button type="button" onClick={() => void mutate("policy")} disabled={!canActivate} className="min-h-11 border border-ink bg-seal px-4 py-2.5 text-sm text-paper disabled:opacity-50">{working ? uiCopy("sourceClaimPolicy.saving") : mode === "free" ? uiCopy("sourceClaimPolicy.keepFree") : mode === "paid" ? uiCopy("sourceClaimPolicy.activatePaid") : uiCopy("sourceClaimPolicy.activateCitation")}</button>
    {claim.mode !== "free" && !changed && enabled && controlFresh && <p role="status" className="text-sm">{uiCopy("sourceClaimPolicy.savedEarning")}</p>}
    {message && <div role="status" className="space-y-2 text-sm text-seal"><p>{message}</p><button type="button" onClick={onReload} className="min-h-11 underline">{uiCopy("sourceClaimPolicy.reload")}</button></div>}
  </div>;
}
