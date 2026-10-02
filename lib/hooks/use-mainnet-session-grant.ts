"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import type { Hex, PublicClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserPaymentProfile } from "../browser-payment-profile";
import { getSessionSigner, type SessionSigner } from "../session/session-signer-client";
import { fundOwnerGatewaySession, reconcileOwnerSessionCredit } from "../session/owner-gateway-funding";
import { acknowledgeSessionFundingCredit } from "../buyer/funding-journal";
import { sessionJson } from "../session/browser-session-http";
import { revokeBrowserSessionGrant } from "../session/browser-session-revocation";
import { createSessionGrantConsentMessage, parseSessionGrantConsent } from "../payments/session-grant-consent";
import { createSessionGrantClock } from "../session-grant-time";
import { watchSessionGrantClock } from "../session-grant-liveness";
import { readGatewayCredit } from "../gateway/read-credit";
import type { GrantState } from "./use-session-grant";
import { z } from "zod";

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
  const { data: wallet } = useWalletClient(), rpc = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const owner = wallet?.account?.address.toLowerCase() ?? null;
  const ownerRef = useRef(owner), generation = useRef(0), signerRef = useRef<SessionSigner | null>(null);
  const clock = useRef<ReturnType<typeof createSessionGrantClock> | null>(null);
  useLayoutEffect(() => {
    if (ownerRef.current !== owner) { generation.current += 1; clock.current = null; void signerRef.current?.clear(); }
    ownerRef.current = owner;
  }, [owner]);
  useEffect(() => {
    function changed(event: Event) {
      if ((event as CustomEvent).detail !== "signed-out") return;
      generation.current += 1; clock.current = null;
      void signerRef.current?.clear();
      setState(s => ({ ...s, status: s.sessAddr ? "paused" : "idle", error: null, expiresAt: null, grantEpoch: null }));
    }
    window.addEventListener("keryx:auth", changed);
    return () => { window.removeEventListener("keryx:auth", changed); generation.current += 1; void signerRef.current?.clear(); };
  }, []);
  const signer = useCallback(() => { signerRef.current ??= getSessionSigner(); return signerRef.current; }, []);
  const failure = useCallback((err: unknown) => {
    setState(s => ({ ...s, status: s.sessAddr ? "paused" : "error", error: err instanceof Error ? err.message : "Session unavailable" }));
  }, []);
  const ensureArc = useCallback(async () => {
    if (!wallet || !ownerRef.current) throw new Error("Connect and authenticate the owner wallet first");
    if (await wallet.getChainId() !== profile.chainId) await switchChainAsync({ chainId: profile.chainId });
    if (await wallet.getChainId() !== profile.chainId || (await wallet.getAddresses())[0]?.toLowerCase() !== ownerRef.current)
      throw new Error("Select the authenticated owner wallet on Arc mainnet");
  }, [wallet, switchChainAsync]);
  const publishGrant = useCallback(async (body: unknown, sessAddr: string, started: number) => {
    const expectedOwner = ownerRef.current;
    if (!expectedOwner) throw new Error("Session owner unavailable");
    // Worker independently verifies exact owner signature, network, origin, epoch, cap and expiry.
    await signer().bindGrant();
    const metadata = body as { sessionId: string; expiresAt: string; capMicroUsdc: string; spentMicroUsdc: string };
    const spent = micros.parse(metadata.spentMicroUsdc), cap = micros.parse(metadata.capMicroUsdc);
    const next = createSessionGrantClock(body, { sessionId: expectedOwner, sessAddr }, started, performance.now(), 86400000);
    if (ownerRef.current !== expectedOwner) throw new Error("Session owner changed");
    clock.current = next;
    setState({ status: "active", sessAddr, sessionId: metadata.sessionId, cap: Number(cap)/1e6,
      spent: Number(spent)/1e6, expiresAt: metadata.expiresAt, grantEpoch: next.grantEpoch, error: null });
  }, [signer]);
  const consentGrant = useCallback(async (sessAddr: string, budgetMicros: string) => {
    const expectedOwner = ownerRef.current, expectedGeneration = ++generation.current;
    if (!expectedOwner || !wallet) throw new Error("Owner wallet unavailable");
    await ensureArc(); setState(s => ({ ...s, status: "registering", sessAddr }));
    const challenge = await sessionJson("/api/session/grant/challenge", "POST", { sessAddr, budgetMicros, recover: true }) as { consent: unknown; funding: unknown };
    const consent = parseSessionGrantConsent(challenge.consent, profile);
    const funding = fundingSchema.parse(challenge.funding), available = BigInt(funding.availableMicroUsdc), requested = BigInt(budgetMicros);
    const confirmed = BigInt(funding.confirmedSpentMicroUsdc), retained = BigInt(funding.retainedSpentMicroUsdc), cap = BigInt(consent.capMicroUsdc);
    const proposed = cap > retained ? cap-retained : BigInt(0);
    if (consent.ownerAddr !== expectedOwner || consent.sessAddr !== sessAddr.toLowerCase() ||
      consent.origin !== window.location.origin || confirmed > retained || cap !== confirmed+(requested < available ? requested : available) ||
      proposed !== BigInt(funding.proposedRemainingMicroUsdc) || proposed <= BigInt(0)) throw new Error("Grant consent differs from your current funded budget or retained liabilities");
    setState(s => ({ ...s, consentReview: { cumulativeCapUsdc: Number(cap)/1e6, confirmedSpentUsdc: Number(confirmed)/1e6,
      retainedSpentUsdc: Number(retained)/1e6, remainingCapacityUsdc: Number(proposed)/1e6, availableUsdc: Number(available)/1e6 } }));
    const signature = await wallet.signMessage({ account: wallet.account!, message: createSessionGrantConsentMessage(consent, profile) });
    if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed");
    const sessionSignature = await signer().signGrantConsentProof(consent, signature);
    const started = performance.now(), body = await sessionJson("/api/session/grant", "POST", { consent, signature, sessionSignature });
    if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session registration changed");
    await publishGrant(body, sessAddr, started); return true;
  }, [wallet, ensureArc, publishGrant, signer]);
  const tryRecover = useCallback(async () => {
    if (browserPaymentProfile() !== profile || !owner || ownerRef.current !== owner) return false;
    const expectedOwner = owner, expectedGeneration = ++generation.current;
    try {
      const sessAddr = await signer().restoreRetained(expectedOwner);
      if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) return false;
      setState(s => ({ ...s, status: "paused", sessAddr, sessionId: expectedOwner, error: null }));
      const started = performance.now();
      try { await publishGrant(await sessionJson("/api/session/grant"), sessAddr, started); }
      catch { /* Retained custody remains available for new consent and owner-only withdrawal. */ }
      return true;
    } catch { return false; }
  }, [signer, publishGrant, owner]);
  const generateAndFund = useCallback(async (budgetUsdc: number, addFunds = false) => {
    let expectedGeneration = ++generation.current;
    const expectedOwner = ownerRef.current;
    const assertCurrent = () => { if (generation.current !== expectedGeneration || ownerRef.current !== expectedOwner) throw new Error("Session funding changed; retain the original transaction for recovery"); };
    const requestConsent = async (sessAddr: string, budget: string) => {
      assertCurrent(); expectedGeneration = generation.current+1;
      return consentGrant(sessAddr, budget);
    };
    try {
      const micros = amount(budgetUsdc);
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
      const available = await readGatewayCredit(sessAddr);
      await reconcileOwnerSessionCredit(expectedOwner as Hex, sessAddr, available);
      assertCurrent();
      if (!addFunds && available >= BigInt(micros)) { await requestConsent(sessAddr, micros); return; }
      const funding = await fundOwnerGatewaySession({ owner: expectedOwner as Hex, signer: sessAddr, amountMicros: micros, knownAvailableMicros: available,
        wallet, rpc: rpc as PublicClient, assertCurrent,
        onPhase: phase => setState(s => ({ ...s, status: phase.startsWith("deposit") ? "depositing" : "funding" })) });
      setState(s => ({ ...s, status: "confirming" }));
      // Circle credit can lag on-chain confirmation; bounded polling never repeats a deposit.
      for (let attempt=0; attempt<40; attempt++) {
        assertCurrent();
        const knownAvailable = await readGatewayCredit(sessAddr);
        if (funding.gatewayCreditBefore !== undefined && knownAvailable >= BigInt(funding.gatewayCreditBefore)+BigInt(funding.amount)) {
          await acknowledgeSessionFundingCredit(funding.id, knownAvailable);
          await requestConsent(sessAddr, knownAvailable.toString()); return;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      throw new Error("Deposit is confirmed on-chain. Gateway credit is pending; recover the retained session later without depositing again.");
    } catch (err) { if (generation.current === expectedGeneration && ownerRef.current === expectedOwner) failure(err); }
  }, [wallet, rpc, ensureArc, signer, consentGrant, failure]);
  const recoverViaSignature = useCallback(async () => {
    try {
      if (!ownerRef.current) throw new Error("Connect the original owner wallet first");
      const sessAddr = await signer().restoreRetained(ownerRef.current);
      const available = await readGatewayCredit(sessAddr);
      await reconcileOwnerSessionCredit(ownerRef.current as Hex, sessAddr, available);
      if (available <= BigInt(0)) throw new Error("No available Gateway funds are confirmed; pending liabilities remain retained");
      await consentGrant(sessAddr, available.toString()); return true;
    } catch (err) { failure(err); return false; }
  }, [signer, consentGrant, failure]);
  const extend = useCallback(async () => recoverViaSignature(), [recoverViaSignature]);
  const topUp = useCallback(async (usdc: number) => { await generateAndFund(usdc, true); }, [generateAndFund]);
  const revoke = useCallback(async () => {
    const expectedGeneration = ++generation.current, expectedOwner = ownerRef.current;
    const { sessAddr, sessionId, grantEpoch } = state;
    clock.current = null;
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
  const markExpired = useCallback(() => { clock.current = null; setState(s => s.status === "active" ? { ...s, status: "expired" } : s); }, []);
  useEffect(() => {
    if (state.status !== "active" || !clock.current) return;
    const current = clock.current;
    return watchSessionGrantClock(current, () => clock.current === current && ownerRef.current === current.ownerAddr,
      markExpired, () => { clock.current = null; setState(s => ({ ...s, status: "paused", error: "Session status unavailable. Retained keys and liabilities remain." })); });
  }, [state.status, markExpired]);
  const authorizeSessionPayment = useCallback((reqId: string) => signer().authorizePayment(reqId), [signer]);
  const getSessionWalletClient = useCallback(() => null, []);
  return { state, tryRecover, recoverViaSignature, generateAndFund, topUp, extend, revoke, markExpired,
    getSessionWalletClient, authorizeSessionPayment };
}
