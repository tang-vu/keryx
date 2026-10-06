/**
 * Arc card onramp: a signed-in owner buys USDC with a debit card, Apple Pay or Google Pay
 * through Circle's hosted Arc Onramp and receives it in their own wallet on Arc.
 *
 * Keryx only mints a short-lived widget session. It never sees card or identity data, never
 * receives the purchased USDC and records no purchase state: the owner's on-chain wallet balance
 * is the only evidence that funds arrived. The Circle API key stays on the server.
 */
import { createHash } from "node:crypto";
import { getAddress } from "viem";
import { createOnrampServerKit } from "@circle-fin/onramp-kit/server";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";

/** Circle serves the production purchase flow from this origin only. */
export const ARC_CARD_ONRAMP_WIDGET_ORIGIN = "https://onramp.arc.io";

/** A production key buys with real money, so it is accepted on the mainnet profile alone. */
const LIVE_KEY = /^LIVE_API_KEY:[^:\s]+:[^:\s]+$/;

type Env = Record<string, string | undefined>;

/** A dedicated key may be supplied; otherwise the existing Circle developer key is reused. */
export function arcCardOnrampKey(env: Env = process.env): string | null {
  const key = env.ARC_ONRAMP_API_KEY || env.CIRCLE_API_KEY;
  return key && LIVE_KEY.test(key) ? key : null;
}

/** Explicit activation, mainnet profile, web-session secret and a production key are all required. */
export function arcCardOnrampReady(env: Env = process.env, profile: unknown = config.profile, jwtSecret = config.jwtSecret): boolean {
  return env.KERYX_ARC_CARD_ONRAMP_ENABLED === "true" && profile === ARC_MAINNET_PROFILE
    && !!jwtSecret && arcCardOnrampKey(env) !== null;
}

/** Stable opaque vendor correlation id; the wallet itself is already the delivery address. */
export const arcCardOnrampUserId = (wallet: string) =>
  createHash("sha256").update(`keryx-arc-card-onramp-v1:${wallet.toLowerCase()}`).digest("hex");

export interface ArcCardOnrampSession {
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
  constructor() { super("Arc card onramp unavailable"); }
}

/**
 * Mint one widget session that can only deliver USDC on Arc to `wallet`.
 * `wallet` must come from the authenticated web session, never from a request body.
 */
export async function mintArcCardOnrampSession(
  wallet: string,
  options: { env?: Env; fetch?: typeof globalThis.fetch; now?: number } = {},
): Promise<ArcCardOnrampSession> {
  const key = arcCardOnrampKey(options.env);
  if (!key) throw new ArcCardOnrampError();
  try {
    const destinationWallet = getAddress(wallet);
    // The kit retries transient failures itself; a short per-attempt deadline bounds the request.
    const kit = createOnrampServerKit({ apiKey: key, requestTimeoutMs: 8_000, ...(options.fetch ? { fetch: options.fetch } : {}) });
    const session = await kit.createSession({
      appUserId: arcCardOnrampUserId(destinationWallet),
      destinationAddress: destinationWallet,
      destinationChain: "Arc",
      assets: { pairs: [{ token: "USDC", chain: "arc" }] },
    });
    // The kit forwards an upstream launch URL unchecked; pin it before it reaches a browser.
    const url = new URL(session.widgetUrl);
    if (url.origin !== ARC_CARD_ONRAMP_WIDGET_ORIGIN) throw new ArcCardOnrampError();
    if (typeof session.sessionToken !== "string" || !session.sessionToken) throw new ArcCardOnrampError();
    const expires = Date.parse(session.expiresAt);
    if (!Number.isFinite(expires) || expires <= (options.now ?? Date.now())) throw new ArcCardOnrampError();
    return { ...(typeof session.sessionId === "string" && session.sessionId ? { sessionId: session.sessionId } : {}),
      sessionToken: session.sessionToken, widgetUrl: url.toString(),
      expiresAt: new Date(expires).toISOString(), traceId: session.traceId, destinationWallet };
  } catch { throw new ArcCardOnrampError(); }
}
