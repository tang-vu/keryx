"use client";

import type { W3SSdk } from "@circle-fin/w3s-pw-web-sdk";
import type { ChallengeResult, SignMessageResult, SignTransactionResult } from "@circle-fin/w3s-pw-web-sdk/dist/src/types";
import { z } from "zod";
import { circleWalletPublicConfig, circleWalletPublicConfigured } from "./circle-wallet-config";
import { browserPaymentProfile } from "./browser-payment-profile";
import { AUTH_CHALLENGE_TTL_MS } from "./auth-time-policy";

const CONTINUATION = "keryx-circle-google-oauth-v1";
const IDENTITY = `keryx-circle-owner-${browserPaymentProfile().networkId}`;
const identitySchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), walletId: z.string().uuid(),
  origin: z.string().url(), network: z.string() }).strict();
const pendingSchema = z.object({ state: z.string().regex(/^[a-f0-9]{64}$/), deviceToken: z.string().min(1).max(8192),
  deviceEncryptionKey: z.string().min(1).max(8192), expiresAt: z.number().int().positive(), origin: z.string().url(),
  oauthState: z.string().optional(), oauthNonce: z.string().optional() });
type PendingLogin = z.infer<typeof pendingSchema>;
export type CircleWalletIdentity = { address: `0x${string}`; walletId: string };
let sdk: W3SSdk | undefined;
let identity: CircleWalletIdentity | undefined;
let credentials: { userToken: string; encryptionKey: string; expiresAt: number } | undefined;
let callback: Promise<CircleWalletIdentity | null> | undefined;
let signaturePending = false;
let restore: Promise<CircleWalletIdentity | undefined> | undefined;
let identityRevision = 0;

async function post(path: string, value: unknown) {
  const response = await fetch(`/api/auth/circle/${path}`, { method: "POST", cache: "no-store",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(value), signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(typeof data?.error === "string" ? data.error : "Google wallet operation unavailable");
  return data;
}
function sdkConfig(pending?: PendingLogin) {
  const { appId, googleClientId } = circleWalletPublicConfig();
  return { appSettings: { appId }, ...(pending ? { loginConfigs: { deviceToken: pending.deviceToken,
    deviceEncryptionKey: pending.deviceEncryptionKey, google: { clientId: googleClientId,
      redirectUri: `${window.location.origin}/connect`, selectAccountPrompt: true } } } : {}) };
}
function cleanup(pending?: PendingLogin) {
  sessionStorage.removeItem(CONTINUATION);
  // Circle 1.1.11 stores generic OAuth state keys. Remove only this flow's exact values.
  if (pending?.oauthState && localStorage.getItem("state") === pending.oauthState) {
    localStorage.removeItem("state");
    if (pending.oauthNonce && localStorage.getItem("nonce") === pending.oauthNonce) localStorage.removeItem("nonce");
    if (localStorage.getItem("socialLoginProvider") === "Google") localStorage.removeItem("socialLoginProvider");
  }
}
export function circleWalletIdentity() {
  return identity;
}
export function circleWalletCanSign() { return !!identity && !!credentials && credentials.expiresAt > Date.now(); }
/** Persist only a public account hint. A live wallet-scoped session must authenticate it
 * before it can unlock retained independent browser-budget custody. It never signs. */
export async function restoreCircleWalletIdentity() {
  if (identity) return identity;
  const revision = identityRevision;
  restore ??= (async () => {
    try {
  const raw = localStorage.getItem(IDENTITY); if (!raw) return undefined;
      const stored = identitySchema.parse(JSON.parse(raw));
      if (stored.origin !== window.location.origin || stored.network !== browserPaymentProfile().networkId) return undefined;
      const response = await fetch("/api/auth/session", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const session = response.ok ? (await response.json()).session : null;
      if (revision !== identityRevision || !session || typeof session.address !== "string" || session.address.toLowerCase() !== stored.address.toLowerCase()) return undefined;
      identity = { address: stored.address as `0x${string}`, walletId: stored.walletId }; return identity;
    } catch { return undefined; }
  })().finally(() => { restore = undefined; });
  return restore;
}
export function clearCircleWalletIdentity() {
  identityRevision++;
  identity = undefined; credentials = undefined; sdk?.setAuthentication({ userToken: "", encryptionKey: "" });
  if (typeof window !== "undefined") localStorage.removeItem(IDENTITY);
}
export async function startGoogleWalletLogin() {
  if (!circleWalletPublicConfigured()) throw new Error("Google wallet sign-in is not configured");
  const ready = await fetch("/api/auth/circle/config", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
  if (!ready.ok || !(await ready.json()).available) throw new Error("Google wallet sign-in is not configured");
  const { W3SSdk: SDK } = await import("@circle-fin/w3s-pw-web-sdk");
  const { SocialLoginProvider } = await import("@circle-fin/w3s-pw-web-sdk/dist/src/types");
  clearCircleWalletIdentity(); callback = undefined;
  sdk ??= new SDK(sdkConfig());
  const deviceId = await sdk.getDeviceId();
  const device = await post("device", { deviceId });
  const pending = pendingSchema.parse({ ...device, origin: window.location.origin });
  // Tab-scoped, five-minute Keryx continuation only. User/refresh/encryption credentials never enter storage.
  sessionStorage.setItem(CONTINUATION, JSON.stringify(pending));
  sdk.updateConfigs(sdkConfig(pending));
  await sdk.performLogin(SocialLoginProvider.GOOGLE);
  // performLogin saves state synchronously before setting location.href. Capture it for owned cleanup.
  pending.oauthState = localStorage.getItem("state") ?? undefined;
  pending.oauthNonce = localStorage.getItem("nonce") ?? undefined;
  sessionStorage.setItem(CONTINUATION, JSON.stringify(pending));
}

function execute(challengeId: string): Promise<ChallengeResult | SignMessageResult | SignTransactionResult> {
  if (!sdk || !credentials || credentials.expiresAt <= Date.now()) return Promise.reject(new Error("Google wallet authentication expired; sign in again"));
  sdk.setAuthentication({ userToken: credentials.userToken, encryptionKey: credentials.encryptionKey });
  return new Promise((resolve, reject) => {
    // Confirmation can take time. Expiry or a lost callback never retries a signing challenge.
    const timer = setTimeout(() => reject(new Error("Wallet confirmation timed out; review the original operation before retrying")), 180_000);
    sdk!.execute(challengeId, (error, result) => {
      clearTimeout(timer);
      if (error || !result || result.status !== "COMPLETE") {
        reject(Object.assign(new Error(error?.code === 155701 ? "Wallet confirmation cancelled" : "Wallet confirmation could not be completed"),
          { code: error?.code === 155701 ? 4001 : -32000 }));
      } else resolve(result);
    });
  });
}

/** Mount only on /connect. Circle verifies Google state/nonce and authenticates its result;
 * our server then independently resolves the token's wallet before creating a Keryx cookie. */
export function resumeGoogleWalletLogin(): Promise<CircleWalletIdentity | null> {
  if (callback) return callback;
  const raw = sessionStorage.getItem(CONTINUATION);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  if (!raw || (!hash.has("id_token") && !hash.has("error"))) return Promise.resolve(null);
  callback = (async () => {
    let pending: PendingLogin | undefined;
    try {
      pending = pendingSchema.parse(JSON.parse(raw));
      if (pending.origin !== window.location.origin || pending.expiresAt <= Date.now()
        || pending.expiresAt > Date.now() + AUTH_CHALLENGE_TTL_MS || !pending.oauthState
        || hash.get("state") !== pending.oauthState) throw new Error("Google login expired; start again");
      if (hash.has("error")) throw new Error("Google sign-in cancelled");
      const { W3SSdk: SDK } = await import("@circle-fin/w3s-pw-web-sdk");
      const login = await new Promise<{ userToken: string; encryptionKey: string }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Google sign-in did not complete; start again")), 20_000);
        const onLogin = (error: { message: string } | undefined, result: { userToken: string; encryptionKey: string } | undefined) => {
          clearTimeout(timer);
          if (error || !result) reject(new Error("Google sign-in could not be verified")); else resolve(result);
        };
        if (sdk) sdk.updateConfigs(sdkConfig(pending), onLogin); else sdk = new SDK(sdkConfig(pending), onLogin);
      });
      cleanup(pending);
      credentials = { userToken: login.userToken, encryptionKey: login.encryptionKey, expiresAt: Date.now() + 55 * 60_000 };
      const prepared = await post("prepare", { userToken: login.userToken, state: pending.state });
      if (!prepared.ready) {
        if (typeof prepared.challengeId !== "string") throw new Error("Wallet initialization is unavailable");
        await execute(prepared.challengeId);
      }
      // Retry only read/account-finalization while Circle indexes the new wallet, never initialization/signing.
      let session: { address?: string; walletId?: string } | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        try { session = await post("session", { userToken: login.userToken, state: pending.state }); break; }
        catch (error) {
          if (attempt === 4 || !(error instanceof Error) || !error.message.includes("still pending")) throw error;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      const verified = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), walletId: z.string().uuid() }).parse(session);
      identityRevision++;
      identity = { address: verified.address as `0x${string}`, walletId: verified.walletId };
      localStorage.setItem(IDENTITY, JSON.stringify({ ...identity, origin: window.location.origin, network: browserPaymentProfile().networkId }));
      window.dispatchEvent(new Event("keryx:auth"));
      try { const channel = new BroadcastChannel("keryx-auth-v1"); channel.postMessage("changed"); channel.close(); } catch { /* Same-tab refresh remains available. */ }
      return identity;
    } catch (error) {
      clearCircleWalletIdentity(); throw error;
    } finally {
      cleanup(pending);
      if (window.location.hash) history.replaceState(history.state, "", `${window.location.pathname}${window.location.search}`);
    }
  })();
  return callback;
}

export async function signCircleWallet(kind: "message" | "typedData" | "transaction", payload: string): Promise<string> {
  if (!credentials || !circleWalletIdentity()) throw new Error("Google wallet authentication expired; sign in again");
  if (signaturePending) throw new Error("Finish the current wallet confirmation first");
  signaturePending = true;
  try {
    const challenge = await post("sign", { userToken: credentials.userToken, kind, payload, idempotencyKey: crypto.randomUUID() });
    const result = await execute(z.string().uuid().parse(challenge.challengeId));
    const data = "data" in result ? result.data : undefined;
    const output = kind === "transaction" && data && "signedTransaction" in data ? data.signedTransaction : data && "signature" in data ? data.signature : undefined;
    return z.string().regex(/^0x[a-fA-F0-9]+$/).parse(output);
  } finally { signaturePending = false; }
}
