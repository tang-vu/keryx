"use client";

import { createMessages } from "@/lib/i18n/messages";
import { createRichMessages } from "@/lib/i18n/rich-messages";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useSiweAuth } from "@/lib/hooks/use-siwe-auth";
import { browserPaymentProfile } from "@/lib/browser-payment-profile";
import { canonicalSourceUrl, claimControlIsFresh, sourceClaimChallengeSchema, sourceClaimProof, sourceClaimProofSchema, sourceClaimProofUrl, sourceClaimSchema, type SourceClaim, type SourceClaimChallenge, type SourceClaimProof, type SourceClaimProofMethod } from "@/lib/sources/public-source-claim";
import { sourceClaimConnectHref, sourceClaimTarget, type SourceClaimDraft } from "@/lib/registration-return";
import { PublicSourceClaimPolicy } from "./public-source-claim-policy";
import { claimRequest } from "./public-source-claim-api";
import { ClaimControlStatus, ClaimTime } from "./public-source-claim-status";
import { PublicSourceClaims } from "./public-source-claims";

const uiCopy = createMessages("en");
const uiRichCopy = createRichMessages("en");

interface InitialClaim extends SourceClaimDraft { rssUrl?: string; name?: string }
interface ProofState { challenge: SourceClaimChallenge; proof: SourceClaimProof; proofUrl: string; proofToken?: string }
const actionStyle = "min-h-11 border border-ink bg-seal px-4 py-2.5 text-sm text-paper disabled:cursor-not-allowed disabled:opacity-50";
function parseProofState(data: Record<string, unknown>, owner: string | undefined, network: string, canonicalUrl?: string): ProofState {
  const challenge = sourceClaimChallengeSchema.parse(data.challenge), file = sourceClaimProofSchema.parse(data.proof);
  if (challenge.wallet !== owner || challenge.network !== network || canonicalUrl && challenge.canonicalUrl !== canonicalUrl || JSON.stringify(sourceClaimProof(challenge)) !== JSON.stringify(file) || data.proofUrl !== sourceClaimProofUrl(challenge.canonicalUrl, challenge.rssUrl, challenge.proofMethod)) throw new Error(uiCopy("sourceClaimForm.proofMismatch"));
  if (challenge.proofMethod === "rss-channel" && (typeof data.proofToken !== "string" || !new RegExp(`^keryx-source-claim-v1:${challenge.nonce}:[a-f0-9]{64}$`).test(data.proofToken))) throw new Error(uiCopy("sourceClaimForm.tokenUnavailable"));
  return { challenge, proof: file, proofUrl: data.proofUrl as string, ...(typeof data.proofToken === "string" ? { proofToken: data.proofToken } : {}) };
}
function relatedClaim(value: unknown, challenge: SourceClaimChallenge): SourceClaim | null {
  if (!value) return null;
  const claim = sourceClaimSchema.parse(value);
  if (claim.id !== challenge.claimId || claim.ownerWallet !== challenge.wallet || claim.network !== challenge.network || claim.canonicalUrl !== challenge.canonicalUrl) throw new Error(uiCopy("sourceClaimForm.savedMismatch"));
  return claim;
}

export function PublicSourceClaimForm({ initial = {}, initialError = "" }: { initial?: InitialClaim; initialError?: string }) {
  const wallet = useAccount(), { session } = useSiweAuth();
  const profile = browserPaymentProfile();
  const owner = session?.address.toLowerCase();
  const accountMatches = wallet.isConnected && !!owner && owner === wallet.address?.toLowerCase();
  const draftMatches = !initial.owner || initial.owner === owner;
  const enabled = accountMatches && draftMatches && wallet.chainId === profile.chainId;
  const identity = `${owner ?? ""}:${wallet.address?.toLowerCase() ?? ""}:${wallet.chainId ?? ""}:${enabled}`;
  const [url, setUrl] = useState(initial.url ?? "");
  const [proofMethod, setProofMethod] = useState<SourceClaimProofMethod>("website-file");
  const [selection, setSelection] = useState<SourceClaimDraft>(initial);
  const selectionRef = useRef(selection);
  useLayoutEffect(() => { selectionRef.current = selection; }, [selection]);
  const [snapshot, setSnapshot] = useState<{ identity: string; claim: SourceClaim | null; proof: ProofState | null } | null>(null);
  const [message, setMessage] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [now, setNow] = useState(0);
  const currentRef = useRef({ identity, enabled });
  const generation = useRef(0), busy = useRef(false), mounted = useRef(true);
  useLayoutEffect(() => { currentRef.current = { identity, enabled }; }, [identity, enabled]);
  useEffect(() => { mounted.current = true; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => { mounted.current = false; window.clearInterval(timer); }; }, []);
  const current = useCallback((token: number, captured: string) => mounted.current && generation.current === token && currentRef.current.identity === captured && currentRef.current.enabled, []);
  const claim = snapshot?.identity === identity ? snapshot.claim : null;
  const proof = snapshot?.identity === identity ? snapshot.proof : null;
  const expired = !!proof && now >= Date.parse(proof.challenge.expiresAt);
  const needsFreshProof = !!claim && !claimControlIsFresh(claim, now);

  const acceptClaim = useCallback((value: unknown, captured: string) => {
    const next = sourceClaimSchema.parse(value);
    if (next.ownerWallet !== owner || next.network !== profile.networkId) throw new Error(uiCopy("sourceClaimForm.claimMismatch"));
    setNow(Date.now()); setSnapshot({ identity: captured, claim: next, proof: null });
    setReviewRevision(value => value + 1);
    setProofMethod(next.proofMethod ?? "website-file");
    setUrl(next.canonicalUrl);
    const draft = { url: next.canonicalUrl, claimId: next.id, ...(next.publicReferenceId ? { referenceId: next.publicReferenceId } : {}), owner: next.ownerWallet };
    setSelection(draft);
    window.history.replaceState(window.history.state, "", sourceClaimTarget(draft));
    return next;
  }, [owner, profile.networkId]);

  const load = useCallback(async () => {
    if (!enabled) return;
    const captured = identity, token = ++generation.current;
    busy.current = true; setLoading(true); setReady(false); setMessage("");
    try {
      const selected = selectionRef.current;
      const lookupUrl = selected.url ?? initial.url;
      const params = new URLSearchParams(selected.challengeId ? { challengeId: selected.challengeId } : selected.claimId ? { claimId: selected.claimId } : lookupUrl ? { canonicalUrl: canonicalSourceUrl(lookupUrl) } : {});
      if (params.size) {
        const data = await claimRequest(`/api/source-claims?${params}`);
        if (!current(token, captured)) return;
        if (data.challenge) {
          const saved = parseProofState(data, owner, profile.networkId);
          setProofMethod(saved.challenge.proofMethod ?? "website-file");
          setNow(Date.now()); setSnapshot({ identity: captured, claim: relatedClaim(data.claim, saved.challenge), proof: saved });
        } else if (data.claim) acceptClaim(data.claim, captured);
        else setSnapshot({ identity: captured, claim: null, proof: null });
      }
      if (current(token, captured)) setReady(true);
    } catch (error) { if (current(token, captured)) { setMessage(error instanceof Error ? error.message : uiCopy("sourceClaimForm.loadFailed")); if (selectionRef.current.challengeId) setReady(true); } }
    finally { if (generation.current === token) busy.current = false; if (mounted.current && generation.current === token) setLoading(false); }
  }, [enabled, identity, initial.url, owner, profile.networkId, acceptClaim, current]);
  useEffect(() => { const timer = window.setTimeout(() => { if (enabled) void load(); else { generation.current++; busy.current = false; setLoading(false); setReady(false); } }, 0); return () => window.clearTimeout(timer); }, [enabled, identity, load]);

  const createProof = async () => {
    if (!enabled || busy.current || !ready) return;
    const captured = identity, token = ++generation.current;
    busy.current = true; setLoading(true); setMessage("");
    try {
      const canonicalUrl = canonicalSourceUrl(claim?.canonicalUrl ?? url.trim());
      const rssUrl = claim?.rssUrl ?? (initial.rssUrl && initial.url === canonicalUrl ? initial.rssUrl : proofMethod === "rss-channel" ? canonicalUrl : undefined);
      const data = await claimRequest("/api/source-claims/challenge", { canonicalUrl, ...(rssUrl ? { rssUrl } : {}), ...(proofMethod === "rss-channel" ? { proofMethod } : {}), ...(selection.referenceId && selection.url === canonicalUrl ? { publicReferenceId: selection.referenceId } : {}) });
      if (!current(token, captured)) return;
      const issued = parseProofState(data, owner, profile.networkId, canonicalUrl);
      setNow(Date.now()); setSnapshot({ identity: captured, claim: data.claim ? relatedClaim(data.claim, issued.challenge) : claim, proof: issued });
      const draft = { url: canonicalUrl, challengeId: issued.challenge.id, ...(selection.referenceId && selection.url === canonicalUrl ? { referenceId: selection.referenceId } : {}), owner };
      // Retain source context, not a local assertion of verification or monetization.
      setSelection(draft); window.history.replaceState(window.history.state, "", sourceClaimTarget(draft));
      setMessage(proofMethod === "rss-channel" ? uiCopy("sourceClaimForm.publishToken") : uiCopy("sourceClaimForm.publishFile"));
    } catch (error) { if (current(token, captured)) setMessage(error instanceof Error ? error.message : uiCopy("sourceClaimForm.createFailed")); }
    finally { if (generation.current === token) busy.current = false; if (mounted.current && generation.current === token) setLoading(false); }
  };
  const verify = async () => {
    if (!enabled || busy.current || !proof || expired) return;
    const captured = identity, token = ++generation.current;
    busy.current = true; setLoading(true); setMessage("");
    try {
      const data = await claimRequest("/api/source-claims/verify", { challengeId: proof.challenge.id });
      if (!current(token, captured)) return;
      acceptClaim(data.claim, captured);
      setMessage(uiCopy("sourceClaimForm.verifiedNotice"));
    } catch (error) { if (current(token, captured)) setMessage(error instanceof Error ? error.message : uiCopy("sourceClaimForm.verifyFailed")); }
    finally { if (generation.current === token) busy.current = false; if (mounted.current && generation.current === token) setLoading(false); }
  };
  const copyProof = async () => { if (!proof) return; try { await navigator.clipboard.writeText(proof.challenge.proofMethod === "rss-channel" ? proof.proofToken! : JSON.stringify(proof.proof, null, 2)); setMessage(uiCopy("sourceClaimForm.copied")); } catch { setMessage(uiCopy("sourceClaimForm.copyUnavailable")); } };
  const downloadProof = () => { if (!proof) return; const objectUrl = URL.createObjectURL(new Blob([JSON.stringify(proof.proof, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = objectUrl; a.download = "keryx-source-claim.json"; a.click(); URL.revokeObjectURL(objectUrl); };
  const connectHref = sourceClaimConnectHref({ ...selection, url: url || selection.url, owner: selection.owner ?? wallet.address?.toLowerCase() });
  const browsingClaims = !selection.url && !selection.claimId && !selection.challengeId;
  const ownedClaims = enabled && owner ? <PublicSourceClaims key={identity} owner={owner} network={profile.networkId} enabled={!loading} now={now} /> : null;
  return <div className="mt-8 space-y-6">
    {browsingClaims && ownedClaims}
    <section className="space-y-3 border border-ink bg-paper-2 p-5" aria-labelledby="claim-source-url-title">
      <h2 id="claim-source-url-title" className="font-display text-2xl">{uiCopy("sourceClaimForm.choose")}</h2>
      <label htmlFor="claim-source-url" className="block text-sm">{uiCopy("sourceClaimForm.urlLabel")}</label>
      <input id="claim-source-url" type="url" value={url} onChange={event => setUrl(event.target.value)} readOnly={!!claim || !!proof} placeholder="https://your-site.example/article" className="min-h-11 w-full min-w-0 border border-line bg-paper px-3 text-sm" />
      <p className="text-sm leading-relaxed text-ink-2">{uiCopy("sourceClaimForm.supportedProof")}</p>
      {enabled && <fieldset disabled={loading} className="space-y-2 text-sm"><legend className="mb-2 font-semibold">{uiCopy("sourceClaimForm.proofMethod")}</legend><label className="flex min-h-11 items-center gap-2"><input type="radio" name="claim-proof-method" checked={proofMethod === "website-file"} onChange={() => setProofMethod("website-file")} />{uiCopy("sourceClaimForm.websiteMethod")}</label><label className="flex min-h-11 items-center gap-2"><input type="radio" name="claim-proof-method" checked={proofMethod === "rss-channel"} onChange={() => setProofMethod("rss-channel")} />{uiCopy("sourceClaimForm.feedMethod")}</label><p className="text-ink-2">{uiCopy("sourceClaimForm.feedPair")}</p></fieldset>}
      {(claim || proof || selection.url || selection.claimId) && <Link href="/claim-source" className="inline-block min-h-11 py-2 text-sm underline">{uiCopy("sourceClaimForm.anotherSource")}</Link>}
      {session === undefined ? <p role="status" className="text-sm">{uiCopy("sourceClaimForm.checkingSignIn")}</p> : !accountMatches ? connectHref ? <Link href={connectHref} className={`${actionStyle} inline-block`}>{uiCopy("sourceClaimForm.connect")}</Link> : <p role="alert">{uiCopy("sourceClaimForm.urlTooLong")}</p> : !draftMatches ? <p role="alert" className="break-all text-sm">{uiRichCopy("sourceClaimForm.draftWallet", { owner: initial.owner ?? "", restartLink: <Link href="/claim-source" className="underline">{uiCopy("sourceClaimForm.startNew")}</Link> })}</p> : wallet.chainId !== profile.chainId ? <p role="status" className="text-sm">{uiRichCopy("sourceClaimForm.switchWallet", { network: profile.label, connectionLink: <Link href={connectHref ?? "/connect"} className="underline">{uiCopy("sourceClaimForm.reviewConnection")}</Link> })}</p> : <><p className="break-all text-xs text-ink-2">{uiCopy("sourceClaimForm.owner", { owner: owner ?? "", network: profile.label })}</p><button type="button" onClick={() => void createProof()} disabled={loading || !ready || !url.trim()} className={actionStyle}>{claim ? uiCopy("sourceClaimForm.createFresh") : proof ? uiCopy("sourceClaimForm.replaceFile") : uiCopy("sourceClaimForm.create")}</button></>}
    </section>
    {loading && <p role="status" className="text-sm">{uiCopy("sourceClaimForm.checkingClaim")}</p>}
    {message && <p role="status" className="break-words border border-line p-3 text-sm text-ink-2">{message}</p>}
    {enabled && !ready && !loading && <button type="button" className="min-h-11 text-sm underline" onClick={() => void load()}>{uiCopy("sourceClaimForm.reload")}</button>}
    {proof && <section className="space-y-3 border border-ink p-5" aria-labelledby="claim-proof-title">
      <h2 id="claim-proof-title" className="font-display text-2xl">{proof.challenge.proofMethod === "rss-channel" ? uiCopy("sourceClaimForm.publishTokenTitle") : uiCopy("sourceClaimForm.publishFileTitle")}</h2>
      <p className="text-sm leading-relaxed text-ink-2">{proof.challenge.proofMethod === "rss-channel" ? uiCopy("sourceClaimForm.tokenInstructions") : uiCopy("sourceClaimForm.fileInstructions")}</p>
      <p className="break-all font-mono text-xs">{proof.proofUrl}</p>
      <p className="text-sm">{uiRichCopy("sourceClaimForm.expires", { time: <ClaimTime value={proof.challenge.expiresAt} /> })}</p>
      <label htmlFor="claim-proof-json" className="block text-sm">{proof.challenge.proofMethod === "rss-channel" ? uiCopy("sourceClaimForm.tokenLabel") : uiCopy("sourceClaimForm.fileLabel")}</label>
      <textarea id="claim-proof-json" readOnly value={proof.challenge.proofMethod === "rss-channel" ? proof.proofToken : JSON.stringify(proof.proof, null, 2)} rows={proof.challenge.proofMethod === "rss-channel" ? 4 : 12} className="w-full min-w-0 border border-line bg-paper-2 p-3 font-mono text-xs" />
      <div className="flex flex-wrap gap-3"><button type="button" className="min-h-11 border border-line px-3 text-sm" onClick={() => void copyProof()}>{proof.challenge.proofMethod === "rss-channel" ? uiCopy("sourceClaimForm.copyToken") : uiCopy("sourceClaimForm.copyJson")}</button>{proof.challenge.proofMethod !== "rss-channel" && <button type="button" className="min-h-11 border border-line px-3 text-sm" onClick={downloadProof}>{uiCopy("sourceClaimForm.download")}</button>}</div>
      {expired && <p role="status" className="text-sm text-seal">{uiCopy("sourceClaimForm.expired")}</p>}
      <button type="button" onClick={() => void verify()} disabled={loading || expired || !enabled} className={actionStyle}>{uiCopy("sourceClaimForm.check")}</button>
    </section>}
    {claim && <section className="space-y-3 border border-paid/50 bg-paid/5 p-5" aria-labelledby="claim-verified-title">
      <h2 id="claim-verified-title" className="font-display text-2xl">{needsFreshProof ? uiCopy("sourceClaimForm.needsVerification") : uiCopy("sourceClaimForm.verifiedTitle")}</h2>
      <ClaimControlStatus claim={claim} now={now} />
      {needsFreshProof && <div className="space-y-2"><p className="text-sm text-ink-2">{uiCopy("sourceClaimForm.renewNotice")}</p><button type="button" onClick={() => void createProof()} disabled={loading || !enabled || !ready} className={actionStyle}>{uiCopy("sourceClaimForm.renew")}</button></div>}
      <PublicSourceClaimPolicy key={`${identity}:${claim.id}:${claim.revision}:${reviewRevision}`} claim={claim} name={initial.name} enabled={enabled && !loading} controlFresh={!needsFreshProof} onChanged={next => { if (currentRef.current.identity === identity && currentRef.current.enabled) acceptClaim(next, identity); }} onReload={() => void load()} />
    </section>}
    {!browsingClaims && ownedClaims}
  </div>;
}
