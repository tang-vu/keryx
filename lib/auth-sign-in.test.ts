import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SiweMessage } from "siwe";
import { privateKeyToAccount } from "viem/accounts";
import { jwtVerify } from "jose";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./db/sqlite-adapter";
import { AUTH_CHALLENGE_TTL_MS, authChallengeHash } from "./auth-challenge";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn(), limit: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", () => ({ config: { jwtSecret: "synthetic-auth-test-secret-not-production", devWallets: [] } }));
vi.mock("@/lib/activation", () => ({ recordActivationEvent: async () => undefined }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit, clientIp: () => "synthetic-test-client" }));
import { GET as nonceRoute } from "@/app/api/auth/nonce/route";
import { POST as verifyRoute } from "@/app/api/auth/verify/route";

const directory = mkdtempSync(join(tmpdir(), "keryx-auth-route-"));
const file = join(directory, "db.sqlite");
const database = new SqliteAdapter(file);
await database.init();
const second = new SqliteAdapter(file);
await second.init();
const account = privateKeyToAccount(`0x${"1".repeat(64)}`);
type CookieJar = ReturnType<typeof jar>;
const requests = new AsyncLocalStorage<{ jar: CookieJar; db: SqliteAdapter }>();
function jar(nonce?: string) {
  const values = new Map<string, string>(nonce ? [["siwe_nonce", nonce]] : []);
  return { get: (name: string) => values.has(name) ? { value: values.get(name)! } : undefined,
    delete: (name: string) => { values.delete(name); },
    set: (name: string, value: string) => { values.set(name, value); } };
}
beforeEach(() => {
  mocks.cookies.mockImplementation(async () => requests.getStore()!.jar);
  mocks.db.mockImplementation(async () => requests.getStore()!.db);
  mocks.limit.mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(() => {
  second.close(); database.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
  rmdirSync(directory);
});
async function issue() {
  const cookies = jar();
  const response = await requests.run({ jar: cookies, db: database }, () => nonceRoute(new Request("https://keryx.cc/api/auth/nonce")));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const { nonce } = await response.json(); expect(cookies.get("siwe_nonce")?.value).toBe(nonce);
  return nonce as string;
}
async function signed(nonce: string, fields: Record<string, unknown> = {}) {
  const message = new SiweMessage({ domain: "keryx.cc", address: account.address, statement: "Synthetic sign-in test",
    uri: "https://keryx.cc", version: "1", chainId: 5042002, nonce, issuedAt: new Date().toISOString(), ...fields }).prepareMessage();
  return { message, signature: await account.signMessage({ message }) };
}
async function verify(nonce: string, body: unknown, db = database, headers: Record<string, string> = {}) {
  const cookies = jar(nonce);
  const response = await requests.run({ jar: cookies, db }, () => verifyRoute(new Request("https://keryx.cc/api/auth/verify", {
    method: "POST", headers: { host: "keryx.cc", origin: "https://keryx.cc", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  })));
  expect(response.headers.get("cache-control")).toBe("no-store");
  return { response, token: cookies.get("keryx_session")?.value };
}

it("issues a real signed session once and rejects retained-cookie replay", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  const first = await verify(nonce, body);
  expect(first.response.status).toBe(200); expect(first.token).toBeTruthy();
  const claims = await jwtVerify(first.token!, new TextEncoder().encode("synthetic-auth-test-secret-not-production"), { algorithms: ["HS256"] });
  expect(claims.payload.address).toBe(account.address);
  expect((await database.getUser(account.address))?.walletAddress).toBe(account.address.toLowerCase());
  const replay = await verify(nonce, body, second);
  expect(replay.response.status).toBe(401); expect(replay.token).toBeUndefined();
});

it("permits only one of two concurrent requests with the same valid signature", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  const results = await Promise.all([verify(nonce, body), verify(nonce, body, second)]);
  expect(results.map(result => result.response.status).sort()).toEqual([200, 401]);
  expect(results.filter(result => result.token)).toHaveLength(1);
});

it("rejects an attacker-chosen unissued nonce despite a valid signature and cookie", async () => {
  const nonce = "NeverIssued123456";
  const result = await verify(nonce, await signed(nonce));
  expect(result.response.status).toBe(401); expect(result.token).toBeUndefined();
});

it("uses server expiry even if the client omits SIWE expiration", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + AUTH_CHALLENGE_TTL_MS);
  const result = await verify(nonce, body);
  expect(result.response.status).toBe(401); expect(result.token).toBeUndefined();
});

it.each([{ domain: "other.example" }, { chainId: 1 }])("consumes a challenge on invalid SIWE scope", async fields => {
  const nonce = await issue(); const result = await verify(nonce, await signed(nonce, fields));
  expect(result.response.status).toBeGreaterThanOrEqual(400); expect(result.token).toBeUndefined();
  expect(await database.consumeAuthChallenge(authChallengeHash(nonce), Date.now())).toBe(false);
});

it("consumes a challenge on a wrong-wallet signature", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  const other = privateKeyToAccount(`0x${"2".repeat(64)}`);
  body.signature = await other.signMessage({ message: body.message });
  const result = await verify(nonce, body);
  expect(result.response.status).toBeGreaterThanOrEqual(400); expect(result.token).toBeUndefined();
  expect((await verify(nonce, await signed(nonce))).response.status).toBe(401);
});

it("rejects a cross-origin login before consuming its challenge", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  const result = await verify(nonce, body, database, { origin: "https://other.example" });
  expect(result.response.status).toBe(403); expect(result.token).toBeUndefined();
  expect((await verify(nonce, body)).response.status).toBe(200);
});

it("fails closed when challenge issuance or consumption fails", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  vi.spyOn(database, "consumeAuthChallenge").mockRejectedValue(new Error("synthetic storage outage"));
  const result = await verify(nonce, body);
  expect(result.response.status).toBe(503); expect(result.token).toBeUndefined();
  vi.spyOn(database, "createAuthChallenge").mockRejectedValue(new Error("synthetic storage outage"));
  const cookies = jar();
  const response = await requests.run({ jar: cookies, db: database }, () => nonceRoute(new Request("https://keryx.cc/api/auth/nonce")));
  expect(response.status).toBe(503); expect(cookies.get("siwe_nonce")).toBeUndefined();
});

it("rejects oversized or malformed bodies without minting a session", async () => {
  const nonce = await issue();
  for (const body of [{ message: "x".repeat(17000), signature: "0x12" }, { message: {}, signature: [] }]) {
    const result = await verify(nonce, body);
    expect(result.response.status).toBe(400); expect(result.token).toBeUndefined();
  }
});

it("does not issue or consume a challenge when throttled", async () => {
  const nonce = await issue(); const body = await signed(nonce);
  mocks.limit.mockImplementation(async () => Response.json({ error: "rate limited" }, { status: 429 }));
  const result = await verify(nonce, body);
  expect(result.response.status).toBe(429); expect(result.token).toBeUndefined();
  const cookies = jar();
  const response = await requests.run({ jar: cookies, db: database }, () => nonceRoute(new Request("https://keryx.cc/api/auth/nonce")));
  expect(response.status).toBe(429); expect(cookies.get("siwe_nonce")).toBeUndefined();
  expect(await database.consumeAuthChallenge(authChallengeHash(nonce), Date.now())).toBe(true);
});
