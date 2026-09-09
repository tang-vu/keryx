import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SignJWT } from "jose";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./db/sqlite-adapter";
import { issueWebSession, isWebSessionActive, parseWebSession, webSessionHash } from "./auth-session";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", () => ({ config: { jwtSecret: "synthetic-session-secret", devWallets: [] } }));
import { POST as signout } from "@/app/api/auth/signout/route";
import { GET as sessionRoute } from "@/app/api/auth/session/route";
import { getSession } from "./auth";
import { GET as listSessions, DELETE as revokeOthers } from "@/app/api/auth/sessions/route";
import { DELETE as revokeSelected } from "@/app/api/auth/sessions/[id]/route";

const root = mkdtempSync(join(tmpdir(), "keryx-web-session-")); const file = join(root, "db.sqlite");
const database = new SqliteAdapter(file); await database.init();
const storage = new AsyncLocalStorage<ReturnType<typeof cookieJar>>();
const secret = "synthetic-session-secret", alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`;
function cookieJar(token?: string) {
  let value = token;
  return { get: () => value ? { value } : undefined, delete: () => { value = undefined; } };
}
beforeEach(() => { mocks.cookies.mockImplementation(async () => storage.getStore()!); mocks.db.mockResolvedValue(database); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
afterAll(() => { database.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true }); rmdirSync(root); });
const issue = (wallet = alice) => issueWebSession(database, secret, wallet, "asker");
const lookup = (token: string) => storage.run(cookieJar(token), () => sessionRoute());
const logoutRequest = (origin = "https://keryx.cc") => new Request("https://keryx.cc/api/auth/signout", { method: "POST", headers: { host: "keryx.cc", origin } });

it("lists only the signed-in wallet and revokes selected or all other sessions without crossing wallets", async () => {
  const wallet = `0x${"c".repeat(40)}`, otherWallet = `0x${"d".repeat(40)}`;
  const current = await issue(wallet), other = await issue(wallet), third = await issue(wallet), foreign = await issue(otherWallet);
  const id = async (token: string) => webSessionHash((await parseWebSession(token, secret))!.jti);
  const currentId = await id(current.token), otherId = await id(other.token), foreignId = await id(foreign.token);
  const asCurrent = <T>(fn: () => T) => storage.run(cookieJar(current.token), fn);
  const list = await asCurrent(() => listSessions());
  expect(list.headers.get("cache-control")).toBe("no-store");
  const body = await list.json();
  expect(body.sessions).toHaveLength(3); expect(body.truncated).toBe(false);
  expect(body.sessions.filter((s: { current: boolean }) => s.current).map((s: { id: string }) => s.id)).toEqual([currentId]);
  expect(JSON.stringify(body)).not.toContain(current.token);
  expect(body.sessions.some((s: { id: string }) => s.id === foreignId)).toBe(false);
  const selected = (sessionId: string) => asCurrent(() => revokeSelected(logoutRequest(), { params: Promise.resolve({ id: sessionId }) }));
  expect((await selected(foreignId)).status).toBe(200); expect((await lookup(foreign.token)).status).toBe(200);
  expect((await selected(currentId)).status).toBe(409); expect((await lookup(current.token)).status).toBe(200);
  expect((await selected(otherId)).status).toBe(200); expect((await selected(otherId)).status).toBe(200);
  expect((await lookup(other.token)).status).toBe(401); expect((await lookup(third.token)).status).toBe(200);
  expect((await asCurrent(() => revokeOthers(logoutRequest()))).status).toBe(200);
  expect((await lookup(third.token)).status).toBe(401); expect((await lookup(current.token)).status).toBe(200);
  expect((await lookup(foreign.token)).status).toBe(200);
});

it("denies missing/revoked identity and cross-origin management; does not acknowledge no-op deletion", async () => {
  const current = await issue(`0x${"e".repeat(40)}`), other = await issue(`0x${"e".repeat(40)}`);
  const id = webSessionHash((await parseWebSession(other.token, secret))!.jti);
  expect((await storage.run(cookieJar(), () => listSessions())).status).toBe(401);
  const run = <T>(fn: () => T) => storage.run(cookieJar(current.token), fn);
  expect((await run(() => revokeOthers(logoutRequest("https://foreign.example")))).status).toBe(403);
  expect((await run(() => revokeOthers(new Request("https://keryx.cc", { method: "DELETE" })))).status).toBe(403);
  const noop = vi.spyOn(database, "revokeWebSession").mockResolvedValue(undefined);
  expect((await run(() => revokeSelected(logoutRequest(), { params: Promise.resolve({ id }) }))).status).toBe(503);
  noop.mockRestore();
  const bulkNoop = vi.spyOn(database, "revokeOtherWebSessions").mockResolvedValue(undefined);
  expect((await run(() => revokeOthers(logoutRequest()))).status).toBe(503); bulkNoop.mockRestore();
  const unavailable = vi.spyOn(database, "listWebSessions").mockRejectedValue(new Error("outage"));
  expect((await run(() => listSessions())).status).toBe(503); unavailable.mockRestore();
  await run(() => signout(logoutRequest()));
  expect((await run(() => revokeOthers(logoutRequest()))).status).toBe(401);
  expect((await lookup(other.token)).status).toBe(200);
});

it("bounds inventory while bulk revocation also reaches sessions outside the displayed window", async () => {
  const wallet = `0x${"f".repeat(40)}`;
  const current = await issue(wallet);
  const now = Math.floor(Date.now() / 1000) * 1000;
  for (let index = 1; index <= 105; index++) await database.createWebSession({ hash: index.toString(16).padStart(64, "0"), wallet, issuedAt: now, expiresAt: now + 60000 });
  const run = <T>(fn: () => T) => storage.run(cookieJar(current.token), fn);
  const body = await (await run(() => listSessions())).json();
  expect(body.sessions).toHaveLength(100); expect(body.truncated).toBe(true);
  expect((await run(() => revokeOthers(logoutRequest()))).status).toBe(200);
  expect((await (await run(() => listSessions())).json()).sessions).toHaveLength(1);
});

it("revokes a real token before clearing the cookie and rejects retained-cookie access", async () => {
  const { token } = await issue();
  expect((await lookup(token)).status).toBe(200);
  const cookies = cookieJar(token);
  const response = await storage.run(cookies, () => signout(logoutRequest()));
  expect(response.status).toBe(200); expect(cookies.get()).toBeUndefined();
  expect((await lookup(token)).status).toBe(401);
  expect(await storage.run(cookieJar(token), () => getSession())).toBeNull();
  expect((await storage.run(cookieJar(token), () => signout(logoutRequest()))).status).toBe(200);
});

it("preserves another device and another wallet, including across reopen", async () => {
  const a = await issue(); const b = await issue(); const c = await issue(bob);
  const claims = (await parseWebSession(a.token, secret))!;
  await database.revokeWebSession(webSessionHash(claims.jti), bob);
  expect((await lookup(a.token)).status).toBe(200);
  await database.revokeWebSession(webSessionHash(claims.jti), alice);
  const reopened = new SqliteAdapter(file); await reopened.init();
  try {
    expect(await isWebSessionActive(reopened, claims)).toBe(false);
    expect(await isWebSessionActive(reopened, (await parseWebSession(b.token, secret))!)).toBe(true);
    expect(await isWebSessionActive(reopened, (await parseWebSession(c.token, secret))!)).toBe(true);
  } finally { reopened.close(); }
});

it("does not pretend logout succeeded during storage failure, and allows retry", async () => {
  const { token } = await issue(); const cookies = cookieJar(token);
  const failure = vi.spyOn(database, "revokeWebSession").mockRejectedValue(new Error("test outage"));
  const response = await storage.run(cookies, () => signout(logoutRequest()));
  expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(cookies.get()?.value).toBe(token);
  failure.mockRestore();
  expect((await storage.run(cookies, () => signout(logoutRequest()))).status).toBe(200);
  expect((await lookup(token)).status).toBe(401);
});

it("denies account authority on lookup failure and reports it separately from signed-out", async () => {
  const { token } = await issue();
  vi.spyOn(database, "getWebSession").mockRejectedValue(new Error("test outage"));
  expect((await lookup(token)).status).toBe(503);
  expect(await storage.run(cookieJar(token), () => getSession())).toBeNull();
});

it("refuses a successful-looking revocation that leaves the token active", async () => {
  const { token } = await issue(); const cookies = cookieJar(token);
  vi.spyOn(database, "revokeWebSession").mockResolvedValue(undefined);
  const response = await storage.run(cookies, () => signout(logoutRequest()));
  expect(response.status).toBe(503); expect(cookies.get()?.value).toBe(token);
});

it("does not create a token when durable creation fails and caps expiry to the SIWE request", async () => {
  const expiration = new Date(Date.now() + 60000).toISOString();
  const issued = await issueWebSession(database, secret, alice, "asker", expiration);
  expect(issued.maxAge).toBeLessThanOrEqual(60);
  const claims = (await parseWebSession(issued.token, secret))!;
  expect(claims.exp * 1000).toBeLessThanOrEqual(Date.parse(expiration));
  vi.spyOn(database, "createWebSession").mockRejectedValue(new Error("test outage"));
  await expect(issue()).rejects.toThrow();
});

it("rejects legacy tokens and signed tokens with a wrong issuer, audience or identity", async () => {
  const current = await issue(); const claims = (await parseWebSession(current.token, secret))!;
  const key = new TextEncoder().encode(secret);
  const legacy = await new SignJWT({ address: alice, role: "asker" }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("7d").sign(key);
  expect((await lookup(legacy)).status).toBe(401);
  for (const patch of [{ iss: "other" }, { aud: "other" }, { address: bob }, { jti: "f".repeat(64) }, { role: "admin" }, { address: "invalid" }]) {
    const token = await new SignJWT({ ...claims, iss: "keryx-web", aud: "keryx-account", ...patch })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" }).sign(key);
    expect((await lookup(token)).status).toBe(401);
  }
  for (const header of [{ alg: "HS384", typ: "JWT" }, { alg: "HS256", typ: "other" }]) {
    const token = await new SignJWT({ ...claims, iss: "keryx-web", aud: "keryx-account" }).setProtectedHeader(header).sign(key);
    expect((await lookup(token)).status).toBe(401);
  }
});

it("rejects expiry and a cross-origin logout", async () => {
  const { token } = await issue();
  expect((await storage.run(cookieJar(token), () => signout(logoutRequest("https://other.example")))).status).toBe(403);
  expect((await lookup(token)).status).toBe(200);
  vi.useFakeTimers(); vi.setSystemTime(Date.now() + 8 * 86400_000);
  expect((await lookup(token)).status).toBe(401);
});
