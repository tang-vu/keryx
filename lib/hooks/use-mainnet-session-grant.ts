"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import type { Hex, PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserPaymentProfile } from "../browser-payment-profile";
import { getSessionSigner, type SessionSigner } from "../session/session-signer-client";
import { fundOwnerGatewaySession, reconcileOwnerSessionCredit, acknowledgeOwnerSessionCredit } from "../session/owner-gateway-funding";
import { sessionJson } from "../session/browser-session-http";
import { revokeBrowserSessionGrant } from "../session/browser-session-revocation";
import { createSessionGrantConsentMessage, parseSessionGrantConsent, type SessionGrantConsent } from "../payments/session-grant-consent";
import { createSessionGrantClock } from "../session-grant-time";
import { watchSessionGrantClock } from "../session-grant-liveness";
import { readGatewayCredit } from "../gateway/read-credit";
import type { GrantState } from "./use-session-grant";
import { z } from "zod";
import type { BrowserQuestionBudget } from "../session/browser-session-runtime";
import { readOwnerSessionCredit } from "../session/session-funding-credit";
import { readRetainedSessionGrantReference, retainSessionGrantReference } from "../session/browser-session-grant-reference";

const initial: GrantState = { status: "idle", sessAddr: null, sessionId: null, cap: 0, spent: 0,
  expiresAt: null, grantEpoch: null, error: null };
const micros = z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(n => /^(0|[1-9]\d{0,15})$/.test(n) && BigInt(n) <= BigInt(Number.MAX_SAFE_INTEGER));
const fundingSchema = z.object({ availableMicroUsdc: micros, confirmedSpentMicroUsdc: micros,
  retainedSpentMicroUsdc: micros, proposedRemainingMicroUsdc: micros }).strict();
function amount(usdc: number) {
  if (!Number.isFinite(usdc) || usdc <= 0 || !Number.isSafeInteger(Math.round(usdc*1e6)) ||
    Math.abs(usdc*1e6-Math.round(usdc*1e6)) > 0.000001) throw new Error("Choose a positive budget with at most six decimals");
  return String(Math.round(usdc*1e6));
}

/** Normal public mainnet uses owner consent and retained same-device custody. Expired/revoked
 * grants stop payments without erasing funded keys. No invite list or pilot hardcoded budget.
 */
export function useMainnetSessionGrant() {
  const [state, setState] = useState<GrantState>(initial);
  const [publishedGeneration, setPublishedGeneration] = useState<number | null>(null);
  const { data: wallet } = useWalletClient(), rpc = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const owner = wallet?.account?.address.toLowerCase() ?? null;
  const ownerRef = useRef(owner), generation = useRef(0), signerRef = useRef<SessionSigner | null>(null);
  const clock = useRef<ReturnType<typeof createSessionGrantClock> | null>(null);
  const currentConsent = useRef<SessionGrantConsent | null>(null);
  useLayoutEffect(() => {
    if (ownerRef.current !== owner) { generation.current += 1; clock.current = null; currentConsent.current = null; void signerRef.current?.clear(); }
    ownerRef.current = owner;
  }, [owner]);
  useEffect(() => {
    function changed(event: Event) {
      if ((event as CustomEvent).detail !== "signed-out") return;
      generation.current += 1; clock.current = null; currentConsent.current = null;
      void signerRef.current?.clear();
      setState(s => ({ ...s, status: s.sessAddr ? "paused" : "idle", error: null, expiresAt: null, grantEpoch: null }));
    }
    window.addEventListener("keryx:auth", changed);
    return () => { window.removeEventListener("keryx:auth", changed); generation.current += 1; void signerRef.current?.clear(); };
  }, []);
  const signer = useCallback(() => { signerRef.current ??= getSessionSigner(); return signerRef.current; }, []);
  const lockPaymentAuthority = useCallback(() => {
    generation.current += 1; clock.current = null; currentConsent.current = null;
    void signerRef.current?.clear(); // Mainnet locks heap custody and retains funded recovery.
  }, []);
  const failure = useCallback((err: unknown) => {
    lockPaymentAuthority();
    setState(s => ({ ...s, status: s.sessAddr ? "paused" : "error", error: err instanceof Error ? err.message : "Session unavailable" }));
  }, [lockPaymentAuthority]);
  const ensureArc = useCallback(async () => {
    if (!wallet || !ownerRef.current) throw new Error("Connect and authenticate the owner wallet first");
    if (await wallet.getChainId() !== profile.chainId) await switchChainAsync({ chainId: profile.chainId });
    if (await wallet.getChainId() !== profile.chainId || (await wallet.getAddresses())[0]?.toLowerCase() !== ownerRef.current)
      throw new Error("Select the authenticated owner wallet on Arc mainnet");
  }, [wallet, switchChainAsync]);
  const publishGrant = useCallback(async (body: unknown, sessAddr: string, started: number, expectedGeneration: number) => {
    const expectedOwner = ownerRef.current;
    if (!expectedOwner) throw new Error("Session owner unavailable");
    const assertCurrent = () => {
      if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner)
        throw new Error("Session registration changed");
    };
    assertCurrent();
    const metadata = z.object({ sessionId: z.string(), ownerAddr: z.string(), sessAddr: z.string(),
      grantEpoch: z.string().uuid(), expiresAt: z.string(), capMicroUsdc: micros, spentMicroUsdc: micros }).parse(body);
    const next = createSessionGrantClock(body, { sessionId: expectedOwner, sessAddr }, started, performance.now(), 86400000);
    // Worker independently verifies exact owner signature, network, origin, epoch, cap and expiry.
    const bound = await signer().bindGrant() as { response: { spentMicroUsdc: unknown }; consent: unknown };
    assertCurrent();
    const current = parseSessionGrantConsent(bound.consent, profile);
    if (current.ownerAddr !== expectedOwner || current.sessAddr !== sessAddr.toLowerCase() ||
      current.grantEpoch !== metadata.grantEpoch || current.capMicroUsdc !== metadata.capMicroUsdc ||
      Number(current.expirySeconds)*1000 !== Date.parse(metadata.expiresAt))
      throw new Error("Published grant differs from the current worker-bound consent");
    const spent = micros.parse(bound.response.spentMicroUsdc), cap = current.capMicroUsdc;
    if (BigInt(spent) < BigInt(metadata.spentMicroUsdc)) throw new Error("Retained signer capacity decreased unexpectedly");
    retainSessionGrantReference(current);
    currentConsent.current = current;
    clock.current = next;
    setPublishedGeneration(expectedGeneration);
    setState({ status: "active", sessAddr, sessionId: metadata.sessionId, cap: Number(cap)/1e6,
      spent: Number(spent)/1e6, expiresAt: metadata.expiresAt, grantEpoch: next.grantEpoch, error: null });
  }, [signer]);
  const consentGrant = useCallback(async (sessAddr: string, budgetMicros: string, absoluteTarget?: bigint) => {
    const expectedOwner = ownerRef.current, expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    if (!expectedOwner || !wallet) throw new Error("Owner wallet unavailable");
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed"); };
    await ensureArc(); assertCurrent(); setState(s => ({ ...s, status: "registering", sessAddr }));
    let requested = BigInt(budgetMicros);
    let proposal: { consent: SessionGrantConsent; funding: z.infer<typeof fundingSchema> } | null = null;
    for (let attempt=0; attempt<3; attempt++) {
      const challenge = await sessionJson("/api/session/grant/challenge", "POST", { sessAddr, budgetMicros: requested.toString(), recover: true }) as { consent: unknown; funding: unknown };
      assertCurrent();
      const consent = parseSessionGrantConsent(challenge.consent, profile), funding = fundingSchema.parse(challenge.funding);
      const confirmed = BigInt(funding.confirmedSpentMicroUsdc), available = BigInt(funding.availableMicroUsdc), cap = BigInt(consent.capMicroUsdc);
      if (consent.ownerAddr !== expectedOwner || consent.sessAddr !== sessAddr.toLowerCase() || consent.origin !== window.location.origin ||
        cap !== confirmed+(requested < available ? requested : available)) throw new Error("Grant proposal differs from your selected funded budget");
      if (absoluteTarget !== undefined && cap > absoluteTarget) {
        if (attempt === 2 || confirmed >= absoluteTarget) throw new Error("Retained spend changed; review the selected cumulative cap before renewing");
        requested = absoluteTarget-confirmed; continue;
      }
      proposal = { consent, funding }; break;
    }
    if (!proposal) throw new Error("Session consent target unavailable");
    const { consent, funding } = proposal, available = BigInt(funding.availableMicroUsdc);
    const confirmed = BigInt(funding.confirmedSpentMicroUsdc), retained = BigInt(funding.retainedSpentMicroUsdc), cap = BigInt(consent.capMicroUsdc);
    const proposed = cap > retained ? cap-retained : BigInt(0);
    if (consent.ownerAddr !== expectedOwner || consent.sessAddr !== sessAddr.toLowerCase() ||
      consent.origin !== window.location.origin || confirmed > retained || cap !== confirmed+(requested < available ? requested : available) ||
      proposed !== BigInt(funding.proposedRemainingMicroUsdc) || proposed <= BigInt(0)) throw new Error("Grant consent differs from your current funded budget or retained liabilities");
    setState(s => ({ ...s, consentReview: { cumulativeCapUsdc: Number(cap)/1e6, confirmedSpentUsdc: Number(confirmed)/1e6,
      retainedSpentUsdc: Number(retained)/1e6, remainingCapacityUsdc: Number(proposed)/1e6, availableUsdc: Number(available)/1e6 } }));
    assertCurrent();
    const signature = await wallet.signMessage({ account: wallet.account!, message: createSessionGrantConsentMessage(consent, profile) });
    if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed");
    const sessionSignature = await signer().signGrantConsentProof(consent, signature);
    assertCurrent();
    const started = performance.now(), body = await sessionJson("/api/session/grant", "POST", { consent, signature, sessionSignature });
    if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed");
    await publishGrant(body, sessAddr, started, expectedGeneration); return true;
  }, [wallet, ensureArc, publishGrant, signer]);
  const tryRecover = useCallback(async () => {
    if (browserPaymentProfile() !== profile || !owner || ownerRef.current !== owner) return false;
    const expectedOwner = owner, expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    try {
      const sessAddr = await signer().restoreRetained(expectedOwner);
      if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) return false;
      setState(s => ({ ...s, status: "paused", sessAddr, sessionId: expectedOwner, error: null }));
      const started = performance.now();
      try { await publishGrant(await sessionJson("/api/session/grant"), sessAddr, started, expectedGeneration); }
      catch { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) lockPaymentAuthority(); }
      return true;
    } catch { return false; }
  }, [signer, publishGrant, owner, lockPaymentAuthority]);
  const generateAndFund = useCallback(async (budgetUsdc: number, addFunds = false) => {
    let expectedGeneration = ++generation.current;
    const previous = currentConsent.current;
    clock.current = null; currentConsent.current = null;
    const expectedOwner = ownerRef.current;
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session funding changed; retain the original transaction for recovery"); };
    const requestConsent = async (sessAddr: string, budget: string) => {
      assertCurrent(); expectedGeneration = generation.current+1;
      return consentGrant(sessAddr, budget, targetCap ?? undefined);
    };
    let targetCap: bigint | null = null;
    try {
      const micros = amount(budgetUsdc);
      if (addFunds && (!previous || state.status !== "active" || previous.grantEpoch !== state.grantEpoch || previous.ownerAddr !== expectedOwner))
        throw new Error("Restore the active owner consent before adding to its budget");
      targetCap = addFunds ? BigInt(previous!.capMicroUsdc)+BigInt(micros) : null;
      if (targetCap !== null && targetCap > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Requested cumulative cap exceeds the supported integer range");
      if (!wallet || !rpc || !expectedOwner) throw new Error("Connect and authenticate the owner wallet first");
      setState(s => ({ ...s, status: "switching", error: null })); await ensureArc();
      assertCurrent();
      const context = await signer().initializeOwner(expectedOwner);
      let sessAddr: Hex;
      try { sessAddr = await signer().restoreRetained(expectedOwner); }
      catch {
        setState(s => ({ ...s, status: "generating" }));
        const signature = await wallet.signMessage({ account: wallet.account!, message: context.derivationMessage });
        assertCurrent();
        sessAddr = await signer().deriveRetained(signature);
      }
      assertCurrent(); setState(s => ({ ...s, sessAddr, sessionId: expectedOwner }));
      // Refuse unknown Gateway funds before asking the owner to deposit more.
      const creditSnapshot = await readOwnerSessionCredit(sessAddr, readRetainedSessionGrantReference(expectedOwner, sessAddr));
      const available = BigInt(creditSnapshot.available);
      await reconcileOwnerSessionCredit(expectedOwner as Hex, sessAddr, available);
      assertCurrent();
      if (!addFunds && available >= BigInt(micros)) { await requestConsent(sessAddr, micros); return; }
      const funding = await fundOwnerGatewaySession({ owner: expectedOwner as Hex, signer: sessAddr, amountMicros: micros, knownAvailableMicros: available, creditSnapshot,
        wallet, rpc: rpc as PublicClient, assertCurrent,
        onPhase: phase => setState(s => ({ ...s, status: phase.startsWith("deposit") ? "depositing" : "funding" })) });
      setState(s => ({ ...s, status: "confirming" }));
      // Circle credit can lag on-chain confirmation; bounded polling never repeats a deposit.
      for (let attempt=0; attempt<40; attempt++) {
        assertCurrent();
        const credited = await acknowledgeOwnerSessionCredit(funding, expectedOwner);
        if (credited !== null) {
          const confirmed = BigInt(credited.confirmedSpentMicroUsdc);
          const desired = targetCap === null ? BigInt(micros) : targetCap > confirmed ? targetCap-confirmed : BigInt(0);
          if (desired <= BigInt(0)) throw new Error("The selected consent target is already consumed; review retained liabilities before renewing");
          await requestConsent(sessAddr, desired.toString()); return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      throw new Error("Deposit is confirmed on-chain. Gateway credit is pending; recover the retained session later without depositing again.");
    } catch (err) { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err); }
  }, [wallet, rpc, ensureArc, signer, consentGrant, failure, state.grantEpoch, state.status]);
  const recoverViaSignature = useCallback(async () => {
    const expectedOwner = ownerRef.current; let expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session recovery changed"); };
    try {
      if (!expectedOwner) throw new Error("Connect the original owner wallet first");
      const sessAddr = await signer().restoreRetained(expectedOwner); assertCurrent();
      const available = await readGatewayCredit(sessAddr);
      assertCurrent();
      await reconcileOwnerSessionCredit(expectedOwner as Hex, sessAddr, available); assertCurrent();
      if (available <= BigInt(0)) throw new Error("No available Gateway funds are confirmed; pending liabilities remain retained");
      assertCurrent(); expectedGeneration = generation.current+1;
      await consentGrant(sessAddr, available.toString()); return true;
    } catch (err) { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err); return false; }
  }, [signer, consentGrant, failure]);
  const extend = useCallback(async () => recoverViaSignature(), [recoverViaSignature]);
  const topUp = useCallback(async (usdc: number) => { await generateAndFund(usdc, true); }, [generateAndFund]);
  const revoke = useCallback(async () => {
    const expectedGeneration = ++generation.current, expectedOwner = ownerRef.current;
    const { sessAddr, sessionId, grantEpoch } = state;
    clock.current = null; currentConsent.current = null;
    // Immediately lock heap custody; never delete the original funded key.
    await signer().clear();
    try {
      if (!sessAddr || !sessionId || !grantEpoch || sessionId !== expectedOwner) throw new Error("Restore the current owner grant before requesting server revocation");
      await revokeBrowserSessionGrant({ sessAddr: sessAddr.toLowerCase(), sessionId, grantEpoch });
      if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) return { residualUsdc: 0, sessAddr };
      setState(s => ({ ...s, status: "revoked", error: null, expiresAt: null, grantEpoch: null }));
      return { residualUsdc: 0, sessAddr };
    } catch (err) {
      if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err);
      return { residualUsdc: 0, sessAddr };
    }
  }, [state, signer, failure]);
  const markExpired = useCallback(() => { lockPaymentAuthority(); setState(s => s.status === "active" ? { ...s, status: "expired" } : s); }, [lockPaymentAuthority]);
  useEffect(() => {
    if (state.status !== "active" || !clock.current) return;
    const current = clock.current;
    return watchSessionGrantClock(current, () => clock.current === current && ownerRef.current === current.ownerAddr,
      markExpired, () => { lockPaymentAuthority(); setState(s => ({ ...s, status: "paused", error: "Session status unavailable. Retained keys and liabilities remain." })); });
  }, [state.status, markExpired, lockPaymentAuthority]);
  const authorizeSessionPayment = useCallback(async (reqId: string, question: BrowserQuestionBudget) => {
    const expectedClock = clock.current, consent = currentConsent.current, expectedGeneration = publishedGeneration;
    const expectedOwner = ownerRef.current, currentSigner = signerRef.current;
    const assertCurrent = () => {
      if (expectedGeneration === null || !expectedClock || !consent || !expectedOwner || !currentSigner || generation.current !== expectedGeneration ||
        clock.current !== expectedClock || currentConsent.current !== consent || ownerRef.current !== expectedOwner ||
        expectedClock.remaining(performance.now()) <= 0 || expectedClock.ownerAddr !== expectedOwner ||
        expectedClock.grantEpoch !== consent.grantEpoch || expectedClock.sessAddr !== consent.sessAddr ||
        currentSigner.sessionAddress?.toLowerCase() !== consent.sessAddr) throw new Error("Active session registration unavailable");
    };
    assertCurrent(); // Cached callbacks must not dispatch while liveness/recovery is paused.
    const paymentHeader = await currentSigner!.authorizePayment(reqId, question);
    assertCurrent(); // Suppress a header if pause, expiry or replacement happened during worker awaits.
    return paymentHeader;
  }, [publishedGeneration]);
  const getSessionWalletClient = useCallback(() => null, []);
  return { state, tryRecover, recoverViaSignature, generateAndFund, topUp, extend, revoke, markExpired,
    getSessionWalletClient, authorizeSessionPayment };
}
