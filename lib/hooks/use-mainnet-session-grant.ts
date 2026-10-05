"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { recoverMessageAddress, type Hex, type PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserPaymentProfile } from "../browser-payment-profile";
import { getSessionSigner, type SessionSigner } from "../session/session-signer-client";
import { fundOwnerGatewaySession, reconcileOwnerSessionCredit, acknowledgeOwnerSessionCredit } from "../session/owner-gateway-funding";
import { sessionJson } from "../session/browser-session-http";
import { revokeBrowserSessionGrant } from "../session/browser-session-revocation";
import { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage, parseSessionGrantConsent,
  researchBudgetDurationSchema, sessionGrantDurationSeconds, type SessionGrantConsent } from "../payments/session-grant-consent";
import { createSessionGrantClock } from "../session-grant-time";
import { watchSessionGrantClock } from "../session-grant-liveness";
import type { GrantState } from "./use-session-grant";
import { z } from "zod";
import type { BrowserQuestionBudget } from "../session/browser-session-runtime";
import { readOwnerSessionCredit } from "../session/session-funding-credit";
import { readRetainedSessionGrantReference, retainSessionGrantReference } from "../session/browser-session-grant-reference";
import { SessionCustodyMissingError } from "../session/session-custody-error";

export interface ResearchBudgetOptions { durationSeconds: number; questionCapUsdc: number }

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
  // Advisory previous policy survives lock/expiry. Renewal still verifies the original
  // server-retained signatures, including after reload where this ref is empty.
  const latestConsent = useRef<SessionGrantConsent | null>(null);
  // Acquire synchronously, before any await or React render. Never queue a second
  // funding/consent attempt behind recovery or another wallet action.
  const mounted = useRef(true);
  const operationActive = useRef<{ generation: number; done: Promise<void> } | null>(null);
  const beginOperation = useCallback(() => {
    if (operationActive.current) return null;
    let complete!: () => void;
    const done = new Promise<void>(resolve => { complete = resolve; });
    operationActive.current = { generation: generation.current + 1, done };
    return () => { operationActive.current = null; complete(); };
  }, []);
  useLayoutEffect(() => {
    if (ownerRef.current !== owner) {
      latestConsent.current = null;
      generation.current += 1; clock.current = null; currentConsent.current = null; void signerRef.current?.clear();
      // Reflect disconnected payment authority before repaint, including during a pending wallet prompt.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!owner) setState(s => ({ ...s, status: s.sessionId ? "paused" : "idle", expiresAt: null, grantEpoch: null,
        error: "Connect the original owner wallet to recover the saved session." }));
    }
    ownerRef.current = owner;
  }, [owner]);
  useEffect(() => {
    mounted.current = true;
    function changed(event: Event) {
      if ((event as CustomEvent).detail !== "signed-out") return;
      generation.current += 1; clock.current = null; currentConsent.current = null;
      void signerRef.current?.clear();
      setState(s => ({ ...s, status: s.sessAddr ? "paused" : "idle", error: null, expiresAt: null, grantEpoch: null }));
    }
    window.addEventListener("keryx:auth", changed);
    return () => { mounted.current = false; window.removeEventListener("keryx:auth", changed); generation.current += 1; void signerRef.current?.clear(); };
  }, []);
  const signer = useCallback(() => { signerRef.current ??= getSessionSigner(); return signerRef.current; }, []);
  const lockPaymentAuthority = useCallback(() => {
    generation.current += 1; clock.current = null; currentConsent.current = null;
    void signerRef.current?.clear(); // Mainnet locks heap custody and retains funded recovery.
  }, []);
  const failure = useCallback((err: unknown) => {
    lockPaymentAuthority();
    setState(s => ({ ...s, status: s.sessAddr ? "paused" : "error", error: err instanceof z.ZodError
      ? "Session status could not be verified. Retry recovery on this browser."
      : err instanceof Error ? err.message : "Session unavailable" }));
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
    // Worker independently verifies exact owner signature, network, origin, epoch, cap and expiry.
    const bound = await signer().bindGrant() as { response: { spentMicroUsdc: unknown }; consent: unknown };
    assertCurrent();
    const current = parseSessionGrantConsent(bound.consent, profile);
    const next = createSessionGrantClock(body, { sessionId: expectedOwner, sessAddr }, started, performance.now(), sessionGrantDurationSeconds(current)*1000);
    if (current.ownerAddr !== expectedOwner || current.sessAddr !== sessAddr.toLowerCase() ||
      current.grantEpoch !== metadata.grantEpoch || current.capMicroUsdc !== metadata.capMicroUsdc ||
      Number(current.expirySeconds)*1000 !== Date.parse(metadata.expiresAt))
      throw new Error("Published grant differs from the current worker-bound consent");
    const spent = micros.parse(bound.response.spentMicroUsdc), cap = current.capMicroUsdc;
    if (BigInt(spent) < BigInt(metadata.spentMicroUsdc)) throw new Error("Retained signer capacity decreased unexpectedly");
    retainSessionGrantReference(current);
    currentConsent.current = current;
    latestConsent.current = current;
    clock.current = next;
    setPublishedGeneration(expectedGeneration);
    setState({ status: "active", sessAddr, sessionId: metadata.sessionId, cap: Number(cap)/1e6,
      spent: Number(spent)/1e6, expiresAt: metadata.expiresAt, grantEpoch: next.grantEpoch, error: null,
      ...(current.format === "keryx-session-grant-consent-v2" ? { researchBudget: {
        durationSeconds: current.durationSeconds, questionCapUsdc: Number(current.questionCapMicroUsdc)/1e6 } } : {}) });
  }, [signer]);
  const consentGrant = useCallback(async (sessAddr: string, budgetMicros: string, absoluteTarget?: bigint,
    options?: ResearchBudgetOptions, renew = false, addFunds = false) => {
    const expectedOwner = ownerRef.current, expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    if (!expectedOwner || !wallet) throw new Error("Owner wallet unavailable");
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed"); };
    await ensureArc(); assertCurrent(); setState(s => ({ ...s, status: "registering", sessAddr }));
    let requested = BigInt(budgetMicros);
    const selected = options ? { durationSeconds: researchBudgetDurationSchema.parse(options.durationSeconds),
      questionCapMicroUsdc: amount(options.questionCapUsdc) } : undefined;
    let proposal: { consent: SessionGrantConsent; funding: z.infer<typeof fundingSchema> } | null = null;
    for (let attempt=0; attempt<3; attempt++) {
      const challenge = await sessionJson("/api/session/grant/challenge", "POST", { sessAddr, budgetMicros: requested.toString(), recover: true,
        ...(selected ?? {}), ...(renew ? { renew: true } : {}), ...(addFunds ? { addFunds: true } : {}) }) as { consent: unknown; funding: unknown; renewalAuthority?: unknown };
      assertCurrent();
      const consent = parseSessionGrantConsent(challenge.consent, profile), funding = fundingSchema.parse(challenge.funding);
      const confirmed = BigInt(funding.confirmedSpentMicroUsdc), available = BigInt(funding.availableMicroUsdc), cap = BigInt(consent.capMicroUsdc);
      let expectedCap = confirmed+(requested < available ? requested : available);
      if (renew) {
        const authority = z.object({ consent: z.unknown(), ownerSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
          sessionSignature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict().parse(challenge.renewalAuthority);
        const original = parseSessionGrantConsent(authority.consent, profile);
        if (original.ownerAddr !== expectedOwner || original.sessAddr !== sessAddr.toLowerCase() || original.origin !== window.location.origin ||
          (await recoverMessageAddress({ message: createSessionGrantConsentMessage(original, profile), signature: authority.ownerSignature as Hex })).toLowerCase() !== expectedOwner ||
          (await recoverMessageAddress({ message: createSessionGrantSignerProofMessage(original, profile), signature: authority.sessionSignature as Hex })).toLowerCase() !== original.sessAddr)
          throw new Error("Original research budget proof differs");
        if (latestConsent.current && (latestConsent.current.grantEpoch !== original.grantEpoch || latestConsent.current.capMicroUsdc !== original.capMicroUsdc))
          throw new Error("Research budget changed; restore its latest signed policy before renewing");
        expectedCap = expectedCap < BigInt(original.capMicroUsdc) ? expectedCap : BigInt(original.capMicroUsdc);
        if (!selected && original.format === "keryx-session-grant-consent-v2" && (consent.format !== original.format ||
          consent.durationSeconds !== original.durationSeconds || consent.questionCapMicroUsdc !== original.questionCapMicroUsdc))
          throw new Error("Renewal differs from the original selected policy");
      }
      if (selected && (consent.format !== "keryx-session-grant-consent-v2" || consent.durationSeconds !== selected.durationSeconds ||
        consent.questionCapMicroUsdc !== selected.questionCapMicroUsdc)) throw new Error("Grant proposal differs from your selected duration or per-question maximum");
      if (consent.ownerAddr !== expectedOwner || consent.sessAddr !== sessAddr.toLowerCase() || consent.origin !== window.location.origin ||
        cap !== expectedCap) throw new Error("Grant proposal differs from your selected funded budget");
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
      consent.origin !== window.location.origin || confirmed > retained ||
      proposed !== BigInt(funding.proposedRemainingMicroUsdc) || proposed <= BigInt(0)) throw new Error("Grant consent differs from your current funded budget or retained liabilities");
    setState(s => ({ ...s, consentReview: { cumulativeCapUsdc: Number(cap)/1e6, confirmedSpentUsdc: Number(confirmed)/1e6,
      retainedSpentUsdc: Number(retained)/1e6, remainingCapacityUsdc: Number(proposed)/1e6, availableUsdc: Number(available)/1e6,
      ...(consent.format === "keryx-session-grant-consent-v2" ? { durationSeconds: consent.durationSeconds,
        questionCapUsdc: Number(consent.questionCapMicroUsdc)/1e6 } : {}) } }));
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
    const waiting = operationActive.current;
    if (waiting) {
      // Effect replay or a changed owner may invalidate an older operation.
      // Wait for it to leave the worker, then only read the current owner's
      // custody. User-triggered funding/consent is never queued or replayed.
      if (waiting.generation === generation.current) return false;
      const resumeGeneration = generation.current;
      await waiting.done;
      if (!mounted.current || ownerRef.current !== owner || generation.current !== resumeGeneration) return false;
    }
    const finish = beginOperation();
    if (!finish) return false;
    const expectedOwner = owner, expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    setState(s => ({ ...(s.sessionId === expectedOwner ? s : initial), status: "restoring", sessionId: expectedOwner, error: null }));
    try {
      const sessAddr = await signer().restoreRetained(expectedOwner);
      if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) return false;
      setState(s => ({ ...s, sessAddr }));
      const started = performance.now();
      try {
        const metadata = await sessionJson("/api/session/grant");
        if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) return false;
        if (z.object({ active: z.literal(false) }).strict().safeParse(metadata).success) {
          lockPaymentAuthority();
          setState(s => ({ ...s, status: "paused", expiresAt: null, grantEpoch: null,
            error: "Saved session restored. Review a new spending consent to resume; existing funds remain in Gateway." }));
        } else await publishGrant(metadata, sessAddr, started, expectedGeneration);
      }
      catch (err) { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err); }
      return true;
    } catch (err) {
      if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) {
        if (err instanceof SessionCustodyMissingError) setState(initial);
        else failure(err);
      }
      return false;
    } finally { finish(); }
  }, [signer, publishGrant, owner, failure, beginOperation, lockPaymentAuthority]);
  const generateAndFund = useCallback(async (budgetUsdc: number, addFunds = false, options?: ResearchBudgetOptions) => {
    const finish = beginOperation();
    if (!finish) return;
    let expectedGeneration = ++generation.current;
    const previous = currentConsent.current;
    clock.current = null; currentConsent.current = null;
    const expectedOwner = ownerRef.current;
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session funding changed; retain the original transaction for recovery"); };
    const requestConsent = async (sessAddr: string, budget: string) => {
      assertCurrent(); expectedGeneration = generation.current+1;
      return consentGrant(sessAddr, budget, targetCap ?? undefined, selectedPolicy, false, addFunds);
    };
    let targetCap: bigint | null = null;
    let selectedPolicy = options;
    try {
      const micros = amount(budgetUsdc);
      if (addFunds && (!previous || state.status !== "active" || previous.grantEpoch !== state.grantEpoch || previous.ownerAddr !== expectedOwner))
        throw new Error("Restore the active owner consent before adding to its budget");
      targetCap = addFunds ? BigInt(previous!.capMicroUsdc)+BigInt(micros) : null;
      if (addFunds && !selectedPolicy && previous?.format === "keryx-session-grant-consent-v2") selectedPolicy = {
        durationSeconds: previous.durationSeconds, questionCapUsdc: Number(previous.questionCapMicroUsdc)/1e6 };
      if (selectedPolicy) {
        researchBudgetDurationSchema.parse(selectedPolicy.durationSeconds);
        if (BigInt(amount(selectedPolicy.questionCapUsdc)) > (targetCap ?? BigInt(micros)))
          throw new Error("The per-question maximum must fit inside the selected research budget");
      }
      if (targetCap !== null && targetCap > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Requested cumulative cap exceeds the supported integer range");
      if (!wallet || !rpc || !expectedOwner) throw new Error("Connect and authenticate the owner wallet first");
      setState(s => ({ ...s, status: "switching", error: null })); await ensureArc();
      assertCurrent();
      let sessAddr: Hex;
      try { sessAddr = await signer().restoreRetained(expectedOwner); }
      catch (err) {
        assertCurrent();
        if (!(err instanceof SessionCustodyMissingError)) throw err;
        const context = await signer().initializeOwner(expectedOwner);
        assertCurrent();
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
    finally { finish(); }
  }, [wallet, rpc, ensureArc, signer, consentGrant, failure, state.grantEpoch, state.status, beginOperation]);
  const recoverViaSignature = useCallback(async (options?: ResearchBudgetOptions) => {
    const finish = beginOperation();
    if (!finish) return false;
    const expectedOwner = ownerRef.current; let expectedGeneration = ++generation.current;
    clock.current = null; currentConsent.current = null;
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session recovery changed"); };
    try {
      if (!expectedOwner) throw new Error("Connect the original owner wallet first");
      setState(s => ({ ...(s.sessionId === expectedOwner ? s : initial), status: "restoring", sessionId: expectedOwner, error: null }));
      const sessAddr = await signer().restoreRetained(expectedOwner); assertCurrent();
      const projection = await readOwnerSessionCredit(sessAddr, readRetainedSessionGrantReference(expectedOwner, sessAddr));
      const available = BigInt(projection.available), confirmed = BigInt(projection.confirmedSpentMicroUsdc);
      assertCurrent();
      await reconcileOwnerSessionCredit(expectedOwner as Hex, sessAddr, available); assertCurrent();
      if (available <= BigInt(0)) throw new Error("No available Gateway funds are confirmed; pending liabilities remain retained");
      assertCurrent(); expectedGeneration = generation.current+1;
      const previous = latestConsent.current;
      const target = previous ? BigInt(previous.capMicroUsdc) : undefined;
      const desired = target === undefined ? available : target > confirmed ? target-confirmed : BigInt(0);
      if (desired <= BigInt(0)) throw new Error("The original research budget is consumed. Choose an explicit additional budget to continue.");
      await consentGrant(sessAddr, desired.toString(), target, options, true); return true;
    } catch (err) { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err); return false; }
    finally { finish(); }
  }, [signer, consentGrant, failure, beginOperation]);
  const extend = useCallback(async (options?: ResearchBudgetOptions) => recoverViaSignature(options), [recoverViaSignature]);
  const topUp = useCallback(async (usdc: number, options?: ResearchBudgetOptions) => { await generateAndFund(usdc, true, options); }, [generateAndFund]);
  const revoke = useCallback(async () => {
    const expectedGeneration = ++generation.current, expectedOwner = ownerRef.current;
    const { sessAddr, sessionId, grantEpoch } = state;
    clock.current = null; currentConsent.current = null;
    // Immediately lock heap custody; never delete the original funded key.
    setState(s => ({ ...s, status: "revoking", error: null }));
    try {
      await signer().clear();
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
    if (consent!.format === "keryx-session-grant-consent-v2" &&
      BigInt(question.budgetMicroUsdc) > BigInt(consent!.questionCapMicroUsdc))
      throw new Error("This question exceeds your signed per-question research maximum");
    const paymentHeader = await currentSigner!.authorizePayment(reqId, question);
    assertCurrent(); // Suppress a header if pause, expiry or replacement happened during worker awaits.
    return paymentHeader;
  }, [publishedGeneration]);
  const getSessionWalletClient = useCallback(() => null, []);
  return { state, tryRecover, recoverViaSignature, generateAndFund, topUp, extend, revoke, markExpired,
    getSessionWalletClient, authorizeSessionPayment };
}
