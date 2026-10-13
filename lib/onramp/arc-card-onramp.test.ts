import { describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import {
  ARC_CARD_ONRAMP_WIDGET_ORIGIN, ARC_ONRAMP_SANDBOX_WIDGET_ORIGIN, ArcCardOnrampError,
  arcCardOnrampAvailability, arcCardOnrampEnvironment, arcCardOnrampKey, arcCardOnrampReady,
  arcCardOnrampUserId, mintArcCardOnrampSession,
} from "./arc-card-onramp";

const LIVE = "LIVE_API_KEY:synthetic-id:synthetic-secret";
const TEST = "TEST_API_KEY:synthetic-id:synthetic-secret";
const wallet = `0x${"ab".repeat(20)}`;
const now = Date.parse("2026-10-06T00:00:00.000Z");
const expiresAt = "2026-10-06T00:30:00.000Z";
const enabled = { KERYX_ARC_CARD_ONRAMP_ENABLED: "true", CIRCLE_API_KEY: LIVE };
const mainnet = { env: enabled, profile: ARC_MAINNET_PROFILE };
const sandbox = { KERYX_ARC_ONRAMP_ENABLED: "true", ARC_ONRAMP_ENVIRONMENT: "sandbox", ARC_ONRAMP_SANDBOX_API_KEY: TEST };

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
    expect(arcCardOnrampKey({ CIRCLE_API_KEY: LIVE, ARC_ONRAMP_API_KEY: TEST })).toBeNull();
  });

  it("separates explicit environments and keys without a sandbox fallback", () => {
    expect(arcCardOnrampEnvironment({})).toBe("production");
    for (const environment of ["", "test", "mainnet", "SANDBOX", " production"]) {
      expect(arcCardOnrampEnvironment({ ARC_ONRAMP_ENVIRONMENT: environment })).toBeNull();
      expect(arcCardOnrampReady({ ...enabled, ARC_ONRAMP_ENVIRONMENT: environment }, ARC_MAINNET_PROFILE, "secret")).toBe(false);
      expect(arcCardOnrampKey({ ...enabled, ARC_ONRAMP_ENVIRONMENT: environment })).toBeNull();
    }
    expect(arcCardOnrampKey(sandbox)).toBe(TEST);
    expect(arcCardOnrampKey({ ...sandbox, ARC_ONRAMP_SANDBOX_API_KEY: LIVE })).toBeNull();
    expect(arcCardOnrampKey({ ARC_ONRAMP_ENVIRONMENT: "sandbox", CIRCLE_API_KEY: LIVE, ARC_ONRAMP_API_KEY: LIVE })).toBeNull();
    expect(arcCardOnrampKey({ ...sandbox, ARC_ONRAMP_ENVIRONMENT: "production" })).toBeNull();
  });

  it("keeps Arc sandbox bank unavailable even with the right test key and profile", () => {
    expect(arcCardOnrampAvailability(sandbox, ARC_TESTNET_PROFILE, "secret")).toEqual({
      available: false, environment: "sandbox", widgetOrigin: ARC_ONRAMP_SANDBOX_WIDGET_ORIGIN, bankTransfer: "unavailable",
    });
    expect(arcCardOnrampAvailability(sandbox, ARC_MAINNET_PROFILE, "secret").widgetOrigin).toBeNull();
    expect(arcCardOnrampReady(sandbox, ARC_TESTNET_PROFILE, "secret")).toBe(false);
    expect(arcCardOnrampAvailability(enabled, { ...ARC_MAINNET_PROFILE }, "secret").available).toBe(false);
    const publicStatus = arcCardOnrampAvailability(enabled, ARC_MAINNET_PROFILE, "secret");
    expect(publicStatus).toEqual({ available: true, environment: "production", widgetOrigin: ARC_CARD_ONRAMP_WIDGET_ORIGIN, bankTransfer: "provider-dependent" });
    expect(JSON.stringify(publicStatus)).not.toContain(LIVE);
  });

  it("supports generic activation and lets an explicit generic hold override the legacy flag", () => {
    expect(arcCardOnrampReady({ CIRCLE_API_KEY: LIVE, KERYX_ARC_ONRAMP_ENABLED: "true" }, ARC_MAINNET_PROFILE, "secret")).toBe(true);
    expect(arcCardOnrampReady({ ...enabled, KERYX_ARC_ONRAMP_ENABLED: "false" }, ARC_MAINNET_PROFILE, "secret")).toBe(false);
  });
});

describe("arc card onramp session", () => {
  it("mints an Arc USDC session for exactly the supplied wallet and returns only modeled fields", async () => {
    const fetch = upstream({ sessionId: "session-1", sessionToken: "token-1", expiresAt, internalNote: "must not leak" });
    const session = await mintArcCardOnrampSession(wallet, { ...mainnet, fetch, now });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.circle.com/v1/stablecoinKits/sessions");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${LIVE}`);
    const body = JSON.parse(String(init?.body));
    expect(body.walletAddress.toLowerCase()).toBe(wallet);
    expect(body.appUserId).toBe(arcCardOnrampUserId(wallet));
    expect(body.destinationChain).toBe("Arc");
    expect(body).not.toHaveProperty("referrerDomain");

    expect(Object.keys(session).sort()).toEqual(["destinationWallet", "environment", "expiresAt", "sessionId", "sessionToken", "traceId", "widgetUrl"]);
    expect(session.environment).toBe("production");
    expect(session.destinationWallet.toLowerCase()).toBe(wallet);
    expect(session.expiresAt).toBe(expiresAt);
    const launch = new URL(session.widgetUrl);
    expect(launch.origin).toBe(ARC_CARD_ONRAMP_WIDGET_ORIGIN);
    expect(launch.searchParams.get("pairs")).toBe("USDC:arc");
    expect(JSON.stringify(session)).not.toContain(LIVE);
    expect(JSON.stringify(session)).not.toContain("must not leak");
  });

  it("accepts the production response shape, which carries no session id", async () => {
    const session = await mintArcCardOnrampSession(wallet, { ...mainnet, fetch: upstream({ sessionToken: "token-1", expiresAt }), now });
    expect(session).not.toHaveProperty("sessionId");
    const launch = new URL(session.widgetUrl);
    expect(launch.searchParams.get("sessionToken")).toBe("token-1");
    expect(launch.searchParams.has("pairs")).toBe(true);
  });

  it.each([
    "https://onramp.arc.io.attacker.example/?t=1", "https://onramp-sandbox.arc.io/?t=1",
    "http://onramp.arc.io/?t=1", "https://user:password@onramp.arc.io/?t=1",
  ])("refuses an upstream launch URL with a foreign origin or credentials: %s", async widgetUrl => {
    const fetch = upstream({ sessionId: "s", sessionToken: "t", expiresAt, widgetUrl });
    await expect(mintArcCardOnrampSession(wallet, { ...mainnet, fetch, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
  });

  it.each([
    ["an expired session", { sessionId: "s", sessionToken: "t", expiresAt: "2026-10-05T23:59:59.000Z" }],
    ["a missing expiry", { sessionId: "s", sessionToken: "t" }],
    ["a missing token", { sessionId: "s", expiresAt }],
    ["an overlong session", { sessionId: "s", sessionToken: "t", expiresAt: "2026-10-06T00:30:01.000Z" }],
    ["an invalid expiry", { sessionId: "s", sessionToken: "t", expiresAt: "unknown" }],
  ])("refuses %s", async (_name, value) => {
    await expect(mintArcCardOnrampSession(wallet, { ...mainnet, fetch: upstream(value), now })).rejects.toBeInstanceOf(ArcCardOnrampError);
  });

  it("hides vendor failures and never calls Circle without a usable key or wallet", async () => {
    const failing = upstream({ message: "vendor detail with account id" }, 403);
    const error = await mintArcCardOnrampSession(wallet, { ...mainnet, fetch: failing, now }).catch(value => value);
    expect(error).toBeInstanceOf(ArcCardOnrampError);
    expect(String(error.message)).not.toContain("vendor detail");
    expect(String(error.message)).not.toContain(LIVE);

    const unused = upstream({});
    await expect(mintArcCardOnrampSession(wallet, { ...mainnet, env: { CIRCLE_API_KEY: TEST }, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    await expect(mintArcCardOnrampSession("0x1234", { ...mainnet, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    await expect(mintArcCardOnrampSession(`0x${"0".repeat(40)}`, { ...mainnet, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    expect(unused).not.toHaveBeenCalled();
  });

  it("refuses wrong profiles and unavailable sandbox bank methods before any vendor call", async () => {
    const unused = upstream({});
    for (const options of [
      { env: enabled, profile: ARC_TESTNET_PROFILE }, { env: enabled, profile: { ...ARC_MAINNET_PROFILE } },
      { env: enabled, profile: null },
      { env: sandbox, profile: ARC_MAINNET_PROFILE }, { env: sandbox, profile: ARC_TESTNET_PROFILE },
      { env: { ...sandbox, ARC_ONRAMP_SANDBOX_API_KEY: LIVE }, profile: ARC_TESTNET_PROFILE },
      { env: { ...enabled, ARC_ONRAMP_ENVIRONMENT: "unknown" }, profile: ARC_MAINNET_PROFILE },
    ]) {
      await expect(mintArcCardOnrampSession(wallet, { ...options, fetch: unused, now })).rejects.toBeInstanceOf(ArcCardOnrampError);
    }
    expect(unused).not.toHaveBeenCalled();
  });

  it("keeps vendor launch URLs scoped to the session token and USDC on Arc", async () => {
    const fetch = upstream({ sessionToken: "token-1", expiresAt,
      widgetUrl: "https://onramp.arc.io/?sessionToken=wrong&chains=ethereum&tokens=EURC&pairs=EURC%3Aethereum" });
    const session = await mintArcCardOnrampSession(wallet, { ...mainnet, fetch, now });
    const url = new URL(session.widgetUrl);
    expect(url.searchParams.get("sessionToken")).toBe("token-1");
    expect(url.searchParams.get("pairs")).toBe("USDC:arc");
    expect(url.searchParams.has("chains")).toBe(false);
    expect(url.searchParams.has("tokens")).toBe(false);
  });

  it("derives a stable opaque user id that does not vary with address casing", () => {
    expect(arcCardOnrampUserId(wallet)).toMatch(/^[a-f0-9]{64}$/);
    expect(arcCardOnrampUserId(wallet.toUpperCase().replace("0X", "0x"))).toBe(arcCardOnrampUserId(wallet));
  });
});
