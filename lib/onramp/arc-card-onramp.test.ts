import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import {
  ARC_CARD_ONRAMP_WIDGET_ORIGIN, ArcCardOnrampError, arcCardOnrampKey, arcCardOnrampReady,
  arcCardOnrampUserId, mintArcCardOnrampSession,
} from "./arc-card-onramp";

const LIVE = "LIVE_API_KEY:synthetic-id:synthetic-secret";
const wallet = `0x${"ab".repeat(20)}`;
const now = Date.parse("2026-10-06T00:00:00.000Z");
const expiresAt = "2026-10-06T00:30:00.000Z";
const enabled = { KERYX_ARC_CARD_ONRAMP_ENABLED: "true", CIRCLE_API_KEY: LIVE };

/** Circle wraps the session in a `data` envelope; the kit composes the launch URL when absent. */
function upstream(session: Record<string, unknown>, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify({ data: session }), { status, headers: { "Content-Type": "application/json" } }));
}

describe("arc card onramp readiness", () => {
  it("requires explicit activation, the mainnet profile, a session secret and a production key", () => {
    expect(arcCardOnrampReady(enabled, ARC_MAINNET_PROFILE, "secret")).toBe(true);
    expect(arcCardOnrampReady({ ...enabled, KERYX_ARC_CARD_ONRAMP_ENABLED: "1" }, ARC_MAINNET_PROFILE, "secret")).toBe(false);
    expect(arcCardOnrampReady({ CIRCLE_API_KEY: LIVE }, ARC_MAINNET_PROFILE, "secret")).toBe(false);
    expect(arcCardOnrampReady(enabled, ARC_TESTNET_PROFILE, "secret")).toBe(false);
    expect(arcCardOnrampReady(enabled, ARC_MAINNET_PROFILE, "")).toBe(false);
    expect(arcCardOnrampReady({ KERYX_ARC_CARD_ONRAMP_ENABLED: "true" }, ARC_MAINNET_PROFILE, "secret")).toBe(false);
  });

  it("accepts only a production-format key and prefers the dedicated one", () => {
    expect(arcCardOnrampKey({ CIRCLE_API_KEY: "TEST_API_KEY:a:b" })).toBeNull();
    expect(arcCardOnrampKey({ CIRCLE_API_KEY: "LIVE_API_KEY:only-one-part" })).toBeNull();
    expect(arcCardOnrampKey({ CIRCLE_API_KEY: LIVE, ARC_ONRAMP_API_KEY: "LIVE_API_KEY:dedicated:secret" })).toBe("LIVE_API_KEY:dedicated:secret");
    expect(arcCardOnrampKey({ CIRCLE_API_KEY: LIVE, ARC_ONRAMP_API_KEY: "" })).toBe(LIVE);
  });
});

describe("arc card onramp session", () => {
  it("mints an Arc USDC session for exactly the supplied wallet and returns only modeled fields", async () => {
    const fetch = upstream({ sessionId: "session-1", sessionToken: "token-1", expiresAt, internalNote: "must not leak" });
    const session = await mintArcCardOnrampSession(wallet, { env: enabled, fetch, now });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.circle.com/v1/stablecoinKits/sessions");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${LIVE}`);
    const body = JSON.parse(String(init?.body));
    expect(body.walletAddress.toLowerCase()).toBe(wallet);
    expect(body.appUserId).toBe(arcCardOnrampUserId(wallet));
    expect(body.destinationChain).toBe("Arc");
    expect(body).not.toHaveProperty("referrerDomain");

    expect(Object.keys(session).sort()).toEqual(["destinationWallet", "expiresAt", "sessionId", "sessionToken", "traceId", "widgetUrl"]);
    expect(session.destinationWallet.toLowerCase()).toBe(wallet);
    expect(session.expiresAt).toBe(expiresAt);
    const launch = new URL(session.widgetUrl);
    expect(launch.origin).toBe(ARC_CARD_ONRAMP_WIDGET_ORIGIN);
    expect(JSON.stringify(session)).not.toContain(LIVE);
    expect(JSON.stringify(session)).not.toContain("must not leak");
  });

  it("accepts the production response shape, which carries no session id", async () => {
    const session = await mintArcCardOnrampSession(wallet, { env: enabled, fetch: upstream({ sessionToken: "token-1", expiresAt }), now });
    expect(session).not.toHaveProperty("sessionId");
    const launch = new URL(session.widgetUrl);
    expect(launch.searchParams.get("sessionToken")).toBe("token-1");
    expect(launch.searchParams.has("pairs")).toBe(true);
  });

  it("refuses an upstream launch URL on any other origin", async () => {
    const fetch = upstream({ sessionId: "s", sessionToken: "t", expiresAt, widgetUrl: "https://onramp.arc.io.attacker.example/?t=1" });
    await expect(mintArcCardOnrampSession(wallet, { env: enabled, fetch, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
  });

  it.each([
    ["an expired session", { sessionId: "s", sessionToken: "t", expiresAt: "2026-10-05T23:59:59.000Z" }],
    ["a missing expiry", { sessionId: "s", sessionToken: "t" }],
    ["a missing token", { sessionId: "s", expiresAt }],
  ])("refuses %s", async (_name, value) => {
    await expect(mintArcCardOnrampSession(wallet, { env: enabled, fetch: upstream(value), now })).rejects.toBeInstanceOf(ArcCardOnrampError);
  });

  it("hides vendor failures and never calls Circle without a usable key or wallet", async () => {
    const failing = upstream({ message: "vendor detail with account id" }, 403);
    const error = await mintArcCardOnrampSession(wallet, { env: enabled, fetch: failing, now }).catch(value => value);
    expect(error).toBeInstanceOf(ArcCardOnrampError);
    expect(String(error.message)).not.toContain("vendor detail");

    const unused = upstream({});
    await expect(mintArcCardOnrampSession(wallet, { env: { CIRCLE_API_KEY: "TEST_API_KEY:a:b" }, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    await expect(mintArcCardOnrampSession("0x1234", { env: enabled, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    expect(unused).not.toHaveBeenCalled();
  });

  it("derives a stable opaque user id that does not vary with address casing", () => {
    expect(arcCardOnrampUserId(wallet)).toMatch(/^[a-f0-9]{64}$/);
    expect(arcCardOnrampUserId(wallet.toUpperCase().replace("0X", "0x"))).toBe(arcCardOnrampUserId(wallet));
  });
});
