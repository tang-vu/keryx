"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { claimControlIsFresh, sourceClaimSchema, type SourceClaim } from "@/lib/sources/public-source-claim";
import { registrationConnectHref, registrationDraft, registrationTarget, sourceClaimDraft, type RegistrationDraft, type SourceClaimDraft } from "@/lib/registration-return";
import type { SponsoredRegistration } from "@/lib/sources/registration-sponsor-protocol";
import { creatorRegistrationCopy as copy } from "@/locales/en/creator-registration";
import { PublicSourceClaimForm } from "./public-source-claim-form";
import { PublicSourceClaimPolicy } from "./public-source-claim-policy";
import { SponsoredRegistrationForm } from "./sponsored-registration-form";
import { claimRequest } from "./public-source-claim-api";
import { useUiCopy } from "@/lib/i18n/ui-copy";
const uiEnglish_copy = copy;


function proofDraft(initial: RegistrationDraft) {
  const params = new URLSearchParams();
  let url = initial.url;
  if (!url && initial.rssUrl && !initial.sourceClaimId && !initial.challengeId && !initial.referenceId) {
    url = initial.rssUrl;
  }
  for (const [key, value] of Object.entries({ url, rss: initial.rssUrl, claimId: initial.sourceClaimId, challengeId: initial.challengeId, referenceId: initial.referenceId, owner: initial.owner })) if (value) params.set(key, value);
  try { return { draft: sourceClaimDraft(params), error: "" }; }
  catch(error) { return { draft: { url, rssUrl: initial.rssUrl, owner: initial.owner }, error: error instanceof Error ? error.message : copy.feedRequired }; }
}

/** Draft URL state is public context. Only verified API/chain responses advance the workflow. */
export function CreatorRegistration({ initial = {}, initialError = "" }: { initial?: RegistrationDraft; initialError?: string }) {
  const copy = useUiCopy("creator-registration", uiEnglish_copy);
  const wallet = useAccount(), { session } = useSiweAuth(), profile = browserPaymentProfile();
  const owner = wallet.address?.toLowerCase();
  const authenticated = wallet.isConnected && !!owner && session?.address.toLowerCase() === owner && wallet.chainId === profile.chainId;
  const identity = `${owner ?? ""}:${session?.address.toLowerCase() ?? ""}:${wallet.chainId ?? ""}:${authenticated}`;
  const [draft, setDraft] = useState<RegistrationDraft>(initial);
  const [proofInitial] = useState(() => proofDraft(initial));
  const [snapshot, setSnapshot] = useState<{ identity: string; claim: SourceClaim; original?: SponsoredRegistration } | null>(null);
  const [policyClaim, setPolicyClaim] = useState<{ identity: string; claim: SourceClaim } | null>(null);
  const [policyError, setPolicyError] = useState(""), [policyLoading, setPolicyLoading] = useState(false);
  const [now, setNow] = useState(0);
  const latest = useRef({ identity, owner, authenticated, draft, snapshot }), generation = useRef(0), mounted = useRef(true);
  useLayoutEffect(() => { latest.current = { identity, owner, authenticated, draft, snapshot }; }, [identity, owner, authenticated, draft, snapshot]);
  useEffect(() => { generation.current++; }, [identity]);
  useEffect(() => { mounted.current = true; setNow(Date.now()); const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { mounted.current = false; window.clearInterval(timer); }; }, []);
  const contextError = initialError || proofInitial.error || (draft.chainId !== undefined && draft.chainId !== profile.chainId ? copy.draftNetworkMismatch : "") || (draft.owner && owner && draft.owner !== owner ? copy.draftOwnerMismatch : "");
  const claim = authenticated && !contextError && snapshot?.identity === identity ? snapshot.claim : null;
  const original = claim && snapshot?.identity === identity ? snapshot.original : undefined;
  const fresh = !!claim && claimControlIsFresh(claim, now);

  const withProof = useCallback((next: SourceClaimDraft): RegistrationDraft => ({ ...latest.current.draft,
    url: next.url, rssUrl: next.rssUrl, referenceId: next.referenceId, sourceClaimId: next.claimId, challengeId: next.challengeId,
    owner: latest.current.draft.owner ?? next.owner, chainId: latest.current.draft.chainId ?? profile.chainId,
  }), [profile.chainId]);
  const retain = useCallback((next: RegistrationDraft) => {
    latest.current.draft = next;
    setDraft(next); window.history.replaceState(window.history.state, "", registrationTarget(next));
  }, []);
  const retainProof = useCallback((next: SourceClaimDraft) => retain(withProof(next)), [retain, withProof]);
  const connectForProof = useCallback((next: SourceClaimDraft) => {
    try {
      const target = registrationTarget(withProof(next));
      const validated = registrationDraft(new URL(target, "https://draft.invalid").searchParams);
      return registrationConnectHref(validated);
    } catch { return null; }
  }, [withProof]);
  const loadedClaim = useCallback((next: SourceClaim) => {
    const current = latest.current;
    if (!current.authenticated || (current.draft.owner && next.ownerWallet !== current.draft.owner) || next.ownerWallet !== current.owner || next.network !== profile.networkId ||
      next.id !== current.draft.sourceClaimId || next.canonicalUrl !== current.draft.url || next.rssUrl !== current.draft.rssUrl) return;
    setSnapshot(previous => ({ identity: current.identity, claim: next, ...(previous?.identity === current.identity && previous.claim.id === next.id ? { original: previous.original } : {}) }));
  }, [profile.networkId]);
  const loadPolicy = useCallback(async (registered: SponsoredRegistration, captured: string) => {
    const token = ++generation.current; setPolicyLoading(true); setPolicyError("");
    try {
      const data = await claimRequest(`/api/source-claims?claimId=${encodeURIComponent(registered.claimId)}`);
      if (!mounted.current || token !== generation.current || latest.current.identity !== captured || !latest.current.authenticated) return;
      const next = sourceClaimSchema.parse(data.claim);
      if (next.id !== registered.claimId || next.ownerWallet !== registered.creator || next.network !== profile.networkId || next.canonicalUrl !== registered.canonicalUrl || next.rssUrl !== registered.rssUrl ||
        next.linkedSourceId !== registered.sourceId || next.onchainId?.toLowerCase() !== registered.onchainId.toLowerCase() || next.registryAddress !== registered.registryAddress) throw Error(copy.indexedPolicyUnavailable);
      setPolicyClaim({ identity: captured, claim: next });
    } catch(error) { if (mounted.current && token === generation.current && latest.current.identity === captured) setPolicyError(error instanceof Error ? error.message : copy.indexedPolicyUnavailable); }
    finally { if (mounted.current && token === generation.current) setPolicyLoading(false); }
  }, [profile.networkId]);
  const indexed = useCallback((registered: SponsoredRegistration) => {
    const current = latest.current;
    if (!current.authenticated || registered.creator !== current.owner || registered.chainId !== profile.chainId || registered.state !== "confirmed" ||
      current.snapshot?.identity !== current.identity || current.snapshot.claim.id !== registered.claimId ||
      current.snapshot.claim.canonicalUrl !== registered.canonicalUrl || current.snapshot.claim.rssUrl !== registered.rssUrl) return;
    setSnapshot(previous => {
      if (previous?.identity !== current.identity || previous.claim.id !== registered.claimId || registered.state !== "confirmed") return previous;
      return { ...previous, original: registered };
    });
    void loadPolicy(registered, current.identity);
  }, [loadPolicy, profile.chainId]);
  const policy = original && policyClaim?.identity === identity && policyClaim.claim.id === original.claimId ? policyClaim.claim : null;
  const fallback = registrationTarget({ ...draft, owner: draft.owner ?? owner, chainId: draft.chainId ?? profile.chainId, mode: "wallet-funded" });
  return <div className="space-y-8">
    <header><h1 className="font-display text-[clamp(34px,6vw,58px)] leading-tight text-ink">{copy.unifiedHeading}</h1><p className="mt-4 max-w-[65ch] text-lg leading-relaxed text-ink-2">{copy.unifiedExplanation}</p></header>
    {contextError && <div role="alert" className="space-y-3 border border-seal p-4 text-sm"><p>{contextError}</p><Link className="underline" href="/register">{copy.startNewDraft}</Link></div>}
    <section aria-labelledby="creator-verify-title"><h2 id="creator-verify-title" className="font-display text-2xl">{copy.verificationStep}</h2><p className="mt-2 text-sm text-ink-2">{copy.verificationExplanation}</p>
      {!contextError && <PublicSourceClaimForm initial={{ ...proofInitial.draft, name: initial.name }} hidePolicy requireFeed defaultSourceFromFeed onClaimLoaded={loadedClaim} onDraftChange={retainProof} connectHrefForDraft={connectForProof} />}
    </section>
    {!claim?.rssUrl && authenticated && !contextError && <section aria-label={copy.savedRecoveryLabel}>
      <SponsoredRegistrationForm key={`recovery:${identity}`} canPrepare={false} inspectionOnly />
    </section>}
    {claim?.rssUrl && <section aria-labelledby="creator-register-title"><h2 id="creator-register-title" className="font-display text-2xl">{copy.registrationStep}</h2>
      <SponsoredRegistrationForm key={`${identity}:${claim.id}`} claimId={claim.id} canPrepare={fresh} initialFetchPrice={draft.fetchPrice ?? 0.016} onPriceChange={price => retain({ ...latest.current.draft, fetchPrice: price })} onIndexed={indexed} connectHref={registrationConnectHref(draft)} />
    </section>}
    {original && <section aria-labelledby="creator-policy-title"><h2 id="creator-policy-title" className="font-display text-2xl">{copy.permissionStep}</h2><p className="mt-2 text-sm text-ink-2">{copy.policyReviewExplanation}</p>
      {policy && <PublicSourceClaimPolicy key={`${identity}:${policy.id}:${policy.revision}`} claim={policy} name={draft.name} embedded initialFetchPrice={Number(original.params.fetchPriceUsdc6) / 1_000_000} enabled={authenticated && !policyLoading} controlFresh={claimControlIsFresh(policy, now)} onChanged={next => { if (latest.current.identity === identity && latest.current.authenticated && next.id === policy.id && next.ownerWallet === policy.ownerWallet && next.network === policy.network) setPolicyClaim({ identity, claim: next }); }} onReload={() => void loadPolicy(original, identity)} />}
      {policyError && <p role="alert" className="mt-3 text-sm text-seal">{policyError}</p>}
      {!policy && <button type="button" disabled={policyLoading} onClick={() => void loadPolicy(original, identity)} className="mt-3 min-h-11 text-sm underline">{copy.reloadIndexedPolicy}</button>}
    </section>}
    <aside className="border-t border-line pt-5 text-sm"><p className="text-ink-2">{copy.walletFundedExplanation}</p><Link className="mt-2 inline-block min-h-11 py-2 underline" href={fallback}>{copy.walletFundedRegistrationLink}</Link></aside>
  </div>;
}
