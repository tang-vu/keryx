import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ARC_TESTNET_PROFILE } from "./arc-network-profile";
const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn(), limit: vi.fn(), session: vi.fn(),
  profile: { chainId: 5042, testnet: false }, createSession: vi.fn(), upsert: vi.fn(), consume: vi.fn(), createChallenge: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", () => ({ config: { jwtSecret: "synthetic-circle-auth-secret", devWallets: [], profile: mocks.profile } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit, clientIp: () => "synthetic-circle-client" }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: async () => undefined }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session, resolveRole: async () => "asker" }));
import { POST as device } from "@/app/api/auth/circle/device/route";
import { POST as prepare } from "@/app/api/auth/circle/prepare/route";
import { POST as login } from "@/app/api/auth/circle/session/route";
import { POST as sign } from "@/app/api/auth/circle/sign/route";
import { GET as readiness } from "@/app/api/auth/circle/config/route";
import { CIRCLE_LOGIN_COOKIE, circleLoginHash, readCircleBody, verifiedCircleWallet } from "./circle-wallet-server";

const state = "a".repeat(64), walletId = "00000000-0000-4000-8000-000000000001";
const owner = `0x${"1".repeat(40)}`;
const wallet = { id: walletId, address: owner, blockchain: "ARC", custodyType: "ENDUSER", accountType: "EOA",
  state: "LIVE", userId: "synthetic-social-user", createDate: "2026-10-05T00:00:00Z" };
const userToken = "synthetic_circle_user_token";
const tokens = new Map<string, string>();
let fetcher: ReturnType<typeof vi.fn>;
function req(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://keryx.cc/api/auth/circle/${path}`, { method: "POST",
    headers: { origin: "https://keryx.cc", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
  vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks();
  vi.stubEnv("KERYX_CIRCLE_GOOGLE_ENABLED", "true"); vi.stubEnv("CIRCLE_API_KEY", "synthetic-test-api-key");
  vi.stubEnv("NEXT_PUBLIC_CIRCLE_APP_ID", "synthetic-app"); vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "synthetic-google-client");
  Object.assign(mocks.profile, { chainId: 5042, testnet: false });
  tokens.clear(); tokens.set(CIRCLE_LOGIN_COOKIE, state);
  mocks.cookies.mockResolvedValue({ get: (key: string) => tokens.has(key) ? { value: tokens.get(key) } : undefined,
    delete: (key: string) => tokens.delete(key), set: (key: string, value: string) => tokens.set(key, value) });
  mocks.limit.mockResolvedValue(null); mocks.session.mockResolvedValue({ address: owner, role: "asker" });
  mocks.consume.mockResolvedValue(true); mocks.upsert.mockResolvedValue({ created: true }); mocks.createSession.mockResolvedValue(undefined);
  mocks.createChallenge.mockResolvedValue(undefined);
  mocks.db.mockResolvedValue({ consumeAuthChallenge: mocks.consume, upsertUser: mocks.upsert,
    createWebSession: mocks.createSession, createAuthChallenge: mocks.createChallenge });
  fetcher = vi.fn().mockImplementation(async () => Response.json({ data: { wallets: [wallet] } })); vi.stubGlobal("fetch", fetcher);
});

it("stays unavailable without explicit activation and never calls Circle", async () => {
  vi.stubEnv("KERYX_CIRCLE_GOOGLE_ENABLED", "false");
  expect(await (await readiness()).json()).toEqual({ available: false });
  expect((await login(req("session", { state, userToken }))).status).toBe(503);
  expect(fetcher).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
});
it("issues an ordinary revocable Keryx session only for Circle's authenticated exact-profile EOA", async () => {
  const response = await login(req("session", { state, userToken }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result).toMatchObject({ ok: true, address: owner, walletId, role: "asker" });
  expect(mocks.consume).toHaveBeenCalledWith(circleLoginHash(state), expect.any(Number));
  expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ wallet: owner }));
  expect(tokens.get("keryx_session")).toBeTruthy();
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.circle.com/v1/w3s/wallets?blockchain=ARC&pageSize=50&order=ASC");
  expect(options.headers["X-User-Token"]).toBe(userToken); expect(options.redirect).toBe("error");
  // The vendor API key is used only server-side, never echoed in successful output.
  expect(JSON.stringify(result)).not.toContain("synthetic-test-api-key");
});
it.each([{ custodyType: "DEVELOPER" }, { state: "FROZEN" }, { accountType: "SCA" }, { blockchain: "ARC-TESTNET" }])(
  "refuses an unexpected wallet state/profile instead of granting authority or creating another wallet", async mutation => {
    fetcher.mockImplementation(async () => Response.json({ data: { wallets: [{ ...wallet, ...mutation }] } }));
    expect((await login(req("session", { state, userToken }))).status).toBe(503);
    expect(mocks.createSession).not.toHaveBeenCalled(); expect(mocks.consume).not.toHaveBeenCalled();
    expect((await prepare(req("prepare", { state, userToken }))).status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
it("keeps historical testnet wallets on the configured testnet profile", async () => {
  Object.assign(mocks.profile, { chainId: ARC_TESTNET_PROFILE.chainId, testnet: true });
  fetcher.mockResolvedValue(Response.json({ data: { wallets: [{ ...wallet, blockchain: "ARC-TESTNET" }] } }));
  expect((await verifiedCircleWallet(userToken))?.blockchain).toBe("ARC-TESTNET");
  expect(fetcher.mock.calls[0][0]).toContain("blockchain=ARC-TESTNET");
});
it("does not switch from a frozen oldest wallet to a newer live wallet", async () => {
  const newer = { ...wallet, id: "00000000-0000-4000-8000-000000000002", address: `0x${"2".repeat(40)}`, createDate: "2026-10-05T01:00:00Z" };
  fetcher.mockImplementation(async () => Response.json({ data: { wallets: [newer, { ...wallet, state: "FROZEN" }] } }));
  await expect(verifiedCircleWallet(userToken)).rejects.toThrow();
  expect((await login(req("session", { state, userToken }))).status).toBe(503); expect(mocks.createSession).not.toHaveBeenCalled();
});
it("cannot choose another account/userId from the client", async () => {
  expect((await login(req("session", { state, userToken, address: `0x${"2".repeat(40)}` }))).status).toBe(400);
  expect((await login(req("session", { state, userToken, userId: "other-user" }))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
});
it("denies cross-origin, missing-origin, cookie mismatch and consumed-state attempts", async () => {
  expect((await login(req("session", { state, userToken }, { origin: "https://attacker.invalid" }))).status).toBe(403);
  const missing = req("session", { state, userToken }); missing.headers.delete("origin");
  expect((await login(missing)).status).toBe(403);
  expect((await login(req("session", { state: "b".repeat(64), userToken }))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
  mocks.consume.mockResolvedValue(false);
  expect((await login(req("session", { state, userToken }))).status).toBe(401);
  expect(mocks.createSession).not.toHaveBeenCalled();
});
it("never mints authority or leaks vendor payloads on token rejection or storage failure", async () => {
  fetcher.mockResolvedValue(Response.json({ code: 155105, message: "synthetic-private-vendor-payload" }, { status: 401 }));
  const rejected = await login(req("session", { state, userToken }));
  expect(rejected.status).toBe(401); expect(await rejected.text()).not.toContain("synthetic-private");
  expect(mocks.consume).not.toHaveBeenCalled(); expect(mocks.createSession).not.toHaveBeenCalled();
  fetcher.mockResolvedValue(Response.json({ data: { wallets: [wallet] } }));
  mocks.consume.mockRejectedValue(new Error("synthetic-private-storage-payload"));
  const outage = await login(req("session", { state, userToken }));
  expect(outage.status).toBe(503); expect(await outage.text()).not.toContain("synthetic-private");
  expect(tokens.has("keryx_session")).toBe(false);
});
it("authenticates the Circle token before issuing an EOA initialization challenge", async () => {
  fetcher.mockResolvedValueOnce(Response.json({ data: { wallets: [] } }))
    .mockResolvedValueOnce(Response.json({ data: { challengeId: walletId } }));
  expect(await (await prepare(req("prepare", { state, userToken }))).json()).toEqual({ ready: false, challengeId: walletId });
  expect(fetcher.mock.calls[1][0]).toBe("https://api.circle.com/v1/w3s/user/initialize");
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({ accountType: "EOA", blockchains: ["ARC"] });
  expect(mocks.createSession).not.toHaveBeenCalled();
});
it("creates a CSRF-bound durable login challenge without exposing the server key", async () => {
  fetcher.mockResolvedValue(Response.json({ data: { deviceToken: "synthetic-device-token", deviceEncryptionKey: "synthetic-device-key" } }));
  const response = await device(req("device", { deviceId: walletId })); const data = await response.json();
  expect(response.status).toBe(200); expect(data.state).toMatch(/^[a-f0-9]{64}$/);
  expect(tokens.get(CIRCLE_LOGIN_COOKIE)).toBe(data.state);
  expect(mocks.createChallenge).toHaveBeenCalledWith(circleLoginHash(data.state), expect.any(Number), data.expiresAt);
  expect(JSON.stringify(data)).not.toContain("synthetic-test-api-key");
});
it("signing requires a live Keryx session and the same vendor-authenticated wallet", async () => {
  const body = { userToken, kind: "message", payload: "0x1234", idempotencyKey: walletId };
  mocks.session.mockResolvedValue(null);
  expect((await sign(req("sign", body))).status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  mocks.session.mockResolvedValue({ address: `0x${"2".repeat(40)}` });
  expect((await sign(req("sign", body))).status).toBe(403); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("creates only a user confirmation challenge and rejects wrong-network typed consent", async () => {
  const typed = { domain: { name: "Keryx", chainId: 1 }, types: {}, primaryType: "Consent", message: {} };
  expect((await sign(req("sign", { userToken, kind: "typedData", payload: JSON.stringify(typed), idempotencyKey: walletId }))).status).toBe(400);
  expect(fetcher).toHaveBeenCalledTimes(1);
  fetcher.mockResolvedValueOnce(Response.json({ data: { wallets: [wallet] } })).mockResolvedValueOnce(Response.json({ data: { challengeId: walletId } }));
  const response = await sign(req("sign", { userToken, kind: "message", payload: "0x1234", idempotencyKey: walletId }));
  expect(response.status).toBe(200); expect(JSON.parse(fetcher.mock.calls[2][1].body)).toMatchObject({ walletId, message: "0x1234", encodedByHex: true });
  expect(mocks.createSession).not.toHaveBeenCalled();
});
it("bounds chunked UTF-8 bodies before parsing and applies rate limits before vendor calls", async () => {
  const large = new Request("https://keryx.cc/test", { method: "POST", body: JSON.stringify({ payload: "x".repeat(33000) }) });
  await expect(readCircleBody(large, z.unknown())).rejects.toThrow("Body too large");
  mocks.limit.mockResolvedValue(Response.json({ error: "rate limited" }, { status: 429 }));
  expect((await login(req("session", { state, userToken }))).status).toBe(429); expect(fetcher).not.toHaveBeenCalled();
});
