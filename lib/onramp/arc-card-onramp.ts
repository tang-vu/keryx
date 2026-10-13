/**
 * Bank-first Arc onramp: a signed-in owner uses Circle's hosted eligibility/purchase flow.
 *
 * Keryx only mints a short-lived widget session. It never sees card or identity data, never
 * receives the purchased USDC and records no purchase state: the owner's on-chain wallet balance
 * is the only evidence that funds arrived. The Circle API key stays on the server.
 */
import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { createOnrampServerKit } from "@circle-fin/onramp-kit/server";
import { config } from "../config";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";

/** Circle serves the production purchase flow from this origin only. */
export const ARC_CARD_ONRAMP_WIDGET_ORIGIN = "https://onramp.arc.io";
export const ARC_ONRAMP_SANDBOX_WIDGET_ORIGIN = "https://onramp-sandbox.arc.io";

/** A production key buys with real money, so it is accepted on the mainnet profile alone. */
const LIVE_KEY = /^LIVE_API_KEY:[^:\s]+:[^:\s]+$/;
const TEST_KEY = /^TEST_API_KEY:[^:\s]+:[^:\s]+$/;
const SESSION_LIFETIME_MS = 30 * 60_000;

type Env = Record<string, string | undefined>;
type OnrampEnvironment = "production" | "sandbox";

/** Omission preserves existing production callers; malformed explicit selections fail closed. */
export function arcCardOnrampEnvironment(env: Env = process.env): OnrampEnvironment | null {
  const environment = env.ARC_ONRAMP_ENVIRONMENT ?? "production";
  return environment === "production" || environment === "sandbox" ? environment : null;
}

/** Sandbox has its own TEST key and never falls back to either production credential. */
export function arcCardOnrampKey(env: Env = process.env): string | null {
  const environment = arcCardOnrampEnvironment(env);
  if (environment === "sandbox") {
    const key = env.ARC_ONRAMP_SANDBOX_API_KEY;
    return key && TEST_KEY.test(key) ? key : null;
  }
  if (environment !== "production") return null;
  const key = env.ARC_ONRAMP_API_KEY || env.CIRCLE_API_KEY;
  return key && LIVE_KEY.test(key) ? key : null;
}

/** Trusted configuration alone selects endpoints/profile; no browser or vendor override. */
function onrampConfiguration(env: Env, profile: unknown) {
  const environment = arcCardOnrampEnvironment(env), apiKey = arcCardOnrampKey(env);
  if (!apiKey || (environment === "production" ? profile !== ARC_MAINNET_PROFILE
    : environment !== "sandbox" || profile !== ARC_TESTNET_PROFILE)) return null;
  return { environment, apiKey,
    baseUrl: environment === "production" ? "https://api.circle.com" : "https://api-test.circle.com",
    widgetBaseUrl: environment === "production" ? ARC_CARD_ONRAMP_WIDGET_ORIGIN : ARC_ONRAMP_SANDBOX_WIDGET_ORIGIN };
}

/** Only public capability metadata. Configuration is never proof of country eligibility. */
export function arcCardOnrampAvailability(env: Env = process.env, profile: unknown = config.profile, jwtSecret = config.jwtSecret) {
  const configured = onrampConfiguration(env, profile);
  const enabled = (env.KERYX_ARC_ONRAMP_ENABLED ?? env.KERYX_ARC_CARD_ONRAMP_ENABLED) === "true";
  // Official sandbox bank deposits land only on Ethereum. Never widen Keryx's Arc authority.
  const available = enabled && !!jwtSecret && configured?.environment === "production";
  return { available, environment: arcCardOnrampEnvironment(env),
    widgetOrigin: configured?.widgetBaseUrl ?? null,
    bankTransfer: available ? "provider-dependent" as const : "unavailable" as const };
}

/** Existing callers retain the boolean contract and legacy explicit activation flag. */
export function arcCardOnrampReady(env: Env = process.env, profile: unknown = config.profile, jwtSecret = config.jwtSecret): boolean {
  return arcCardOnrampAvailability(env, profile, jwtSecret).available;
}
/** Stable opaque vendor correlation id; the wallet itself is already the delivery address. */
export const arcCardOnrampUserId = (wallet: string) =>
  createHash("sha256").update(`keryx-arc-card-onramp-v1:${wallet.toLowerCase()}`).digest("hex");

export interface ArcCardOnrampSession {
  environment: "production";
  /** Circle's production API currently omits this; the browser kit treats it as optional. */
  sessionId?: string;
  sessionToken: string;
  widgetUrl: string;
  expiresAt: string;
  traceId: string;
  destinationWallet: string;
}

/** Vendor payloads and messages never reach logs or clients through this error. */
export class ArcCardOnrampError extends Error {
  constructor() { super("USDC funding unavailable"); }
}

/**
 * Mint one widget session that can only deliver USDC on Arc to `wallet`.
 * `wallet` must come from the authenticated web session, never from a request body.
 */
export async function mintArcCardOnrampSession(
  wallet: string,
  options: { env?: Env; profile?: unknown; fetch?: typeof globalThis.fetch; now?: number } = {},
): Promise<ArcCardOnrampSession> {
  const configured = onrampConfiguration(options.env ?? process.env, options.profile === undefined ? config.profile : options.profile);
  // A usable TEST key does not make an Ethereum-only sandbox bank method available on Arc.
  if (!configured || configured.environment !== "production") throw new ArcCardOnrampError();
  if (options.now !== undefined && !Number.isFinite(options.now)) throw new ArcCardOnrampError();
  try {
    const destinationWallet = getAddress(wallet);
    if (/^0x0{40}$/i.test(destinationWallet)) throw new ArcCardOnrampError();
    // The kit retries transient failures itself; a short per-attempt deadline bounds the request.
    const kit = createOnrampServerKit({ apiKey: configured.apiKey, baseUrl: configured.baseUrl,
      widgetBaseUrl: configured.widgetBaseUrl, requestTimeoutMs: 8_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
    const session = await kit.createSession({
      appUserId: arcCardOnrampUserId(destinationWallet),
      destinationAddress: destinationWallet,
      destinationChain: "Arc",
      assets: { pairs: [{ token: "USDC", chain: "arc" }] },
    });
    // The kit forwards an upstream launch URL unchecked; pin it before it reaches a browser.
    const url = new URL(session.widgetUrl);
    if (url.origin !== configured.widgetBaseUrl || url.username || url.password) throw new ArcCardOnrampError();
    if (typeof session.sessionToken !== "string" || !session.sessionToken) throw new ArcCardOnrampError();
    const now = options.now ?? Date.now();
    const expires = Date.parse(session.expiresAt);
    if (!Number.isFinite(now) || !Number.isFinite(expires) || expires <= now || expires > now + SESSION_LIFETIME_MS) throw new ArcCardOnrampError();
    // The pinned kit adds pairs to vendor URLs. Remove competing broad filters and bind the token.
    url.searchParams.delete("chains"); url.searchParams.delete("tokens");
    url.searchParams.set("pairs", "USDC:arc"); url.searchParams.set("sessionToken", session.sessionToken);
    return { environment: "production", ...(typeof session.sessionId === "string" && session.sessionId ? { sessionId: session.sessionId } : {}),
      sessionToken: session.sessionToken, widgetUrl: url.toString(),
      expiresAt: new Date(expires).toISOString(), traceId: session.traceId, destinationWallet };
  } catch { throw new ArcCardOnrampError(); }
}
