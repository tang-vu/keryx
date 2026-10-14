/** AUTHORED, UNRUN. Synthetic JWTs and isolated SQLite only. Fixture provisioning
 * is not operational admission, provider acceptance, custody or paid delivery. */
import { DatabaseSync } from "node:sqlite";
import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { webSessionHash } from "../auth-session";
import type { KeryxDB, WebSessionRecord } from "../db/keryx-db";
import { createAccountRequestAdapter, createOrdinaryAccountMembershipRoutes } from "./request-adapter";
import { createSqliteAccountMembership } from "./sqlite-store";
import { ACCOUNT_MEMBERSHIP_SQL_DATA, ACCOUNT_WEB_SESSION_SCHEMA_DATA } from "./sqlite-schema-data";
import type { AccountMembershipStore, Membership } from "./contracts";

const origin = "https://keryx.example", network = "eip155:5042002" as const;
const secret = "PUBLIC-SYNTHETIC-TEST-SECRET-ACCOUNT267-ONLY";
const url = `${origin}/api/account/membership`;
const consent = { version: 1, privateAccount: true, shareOwnedHistory: true } as const;
const linkConsent = { version: 1, sharePastAndFutureOwnedHistory: true, walletAuthorityStaysSeparate: true } as const;
// PUBLIC SYNTHETIC EOA TEST KEYS; never custody/provider credentials.
const wallets = [1, 2, 3].map(i => privateKeyToAccount(`0x${i.toString(16).padStart(64, "0")}` as `0x${string}`));
type Facade = Pick<KeryxDB, "accountMembership" | "getWebSession">;
let raw: DatabaseSync, store: AccountMembershipStore, db: Facade, sequence: number;
const expectedOf = (m: Membership) => ({ accountId: m.accountId, revision: m.revision });

async function login(options: Partial<{ address: string; jti: string; iat: number; exp: number; issuer: string; audience: string; typ: string; signingSecret: string }> = {}, persist = true) {
  const iat = options.iat ?? Math.floor(Date.now() / 1000), exp = options.exp ?? iat + 3600;
  const jti = options.jti ?? (++sequence).toString(16).padStart(64, "0"), address = options.address ?? wallets[0].address;
  const token = await new SignJWT({ address, role: "asker" }).setProtectedHeader({ alg: "HS256", typ: options.typ ?? "JWT" })
    .setIssuer(options.issuer ?? "keryx-web").setAudience(options.audience ?? "keryx-account")
    .setJti(jti).setIssuedAt(iat).setExpirationTime(exp).sign(new TextEncoder().encode(options.signingSecret ?? secret));
  const row = { hash: webSessionHash(jti), wallet: address.toLowerCase(), issuedAt: iat * 1000, expiresAt: exp * 1000 };
  if (persist) raw.prepare("INSERT INTO web_sessions(hash,wallet,issued_at,expires_at) VALUES(?,?,?,?)").run(row.hash, row.wallet, row.issuedAt, row.expiresAt);
  return { token, row };
}
function request(token?: string, input?: unknown, headers: Record<string, string> = {}, requestUrl = url) {
  return new Request(requestUrl, { method: input === undefined ? "GET" : "POST", headers: {
    ...(token ? { Cookie: `keryx_session=${token}` } : {}),
    ...(input === undefined ? {} : { Origin: origin, "Content-Type": "application/json", "X-Keryx-Expected-Wallet": wallets[0].address }),
    ...headers,
  }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
}
const adapter = (facade = db) => createAccountRequestAdapter({ db: facade, origin, network, jwtSecret: secret });
const routes = (facade = db) => createOrdinaryAccountMembershipRoutes({ db: facade, origin, network, jwtSecret: secret });
function assertPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
beforeEach(() => {
  sequence = 0; raw = new DatabaseSync(":memory:");
  raw.exec(ACCOUNT_WEB_SESSION_SCHEMA_DATA.filter(v => v.sql).map(v => `${v.sql};`).join("\n") + ACCOUNT_MEMBERSHIP_SQL_DATA);
  store = createSqliteAccountMembership(raw);
  db = { getWebSession: vi.fn(async (hash: string): Promise<WebSessionRecord | null> => {
    const row = raw.prepare("SELECT hash,wallet,issued_at,expires_at FROM web_sessions WHERE hash=?").get(hash);
    return row ? { hash: String(row.hash), wallet: String(row.wallet), issuedAt: Number(row.issued_at), expiresAt: Number(row.expires_at) } : null;
  }) };
  Object.defineProperty(db, "accountMembership", { value: store });
});
afterEach(() => { vi.restoreAllMocks(); raw.close(); });

describe("exact ordinary browser request authority", () => {
  it("uses the verified canonical wallet and exact hashed durable login; exposes no JWT, role or account inference", async () => {
    const l = await login(), auth = await adapter().authenticate(request(l.token));
    expect(auth).not.toBeInstanceOf(Response);
    if (auth instanceof Response) throw new Error("Expected synthetic authority");
    expect(auth.session).toEqual({ sessionHash: l.row.hash, wallet: l.row.wallet, issuedAt: l.row.issuedAt, expiresAt: l.row.expiresAt });
    expect(Object.keys(auth).sort()).toEqual(["service", "session"]);
    expect(Object.isFrozen(auth.session)).toBe(true);
    expect(db.getWebSession).toHaveBeenCalledExactlyOnceWith(l.row.hash);
    expect(raw.prepare("SELECT count(*) AS n FROM account267_accounts").get()?.n).toBe(0);
    const response = await routes().GET(request(l.token)), value = await response.json();
    expect(response.status).toBe(200); assertPrivate(response);
    expect(value).toEqual({ version: 1, wallet: l.row.wallet, membership: null, offer: null });
    expect(JSON.stringify(value)).not.toContain(l.row.hash); expect(JSON.stringify(value)).not.toContain(l.token);
    expect(db).not.toHaveProperty("historyMembership");
  });

  it.each(["", "Bearer kx_live_synthetic", "Bearer synthetic-jwt"])("refuses every Authorization presence (%s) before storage", async authorization => {
    const l = await login(), response = await routes().GET(request(l.token, undefined, { Authorization: authorization }));
    expect(response.status).toBe(401); assertPrivate(response); expect(db.getWebSession).not.toHaveBeenCalled();
  });

  it("refuses wallet/session/account/provider headers without a signed cookie", async () => {
    const l = await login(), response = await routes().GET(request(undefined, undefined, {
      "X-Keryx-Expected-Wallet": wallets[0].address, "X-Session-Hash": l.row.hash,
      "X-Account-Id": `acct_${"a".repeat(64)}`, "X-Provider": "circle",
    }));
    expect(response.status).toBe(401); expect(db.getWebSession).not.toHaveBeenCalled();
  });

  it("refuses forged signature, issuer, audience, type, future/expired claims and zero wallet before durable reads", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const options of [
      { signingSecret: `${secret}-foreign` }, { issuer: "foreign" }, { audience: "foreign" }, { typ: "foreign" },
      { iat: now + 60, exp: now + 3600 }, { iat: now - 3600, exp: now },
      { address: `0x${"0".repeat(40)}` }, { jti: "not-a-durable-login" }, { exp: now + 604801 },
    ]) {
      const l = await login(options, false), response = await adapter().authenticate(request(l.token));
      expect(response).toBeInstanceOf(Response); expect((response as Response).status).toBe(401); assertPrivate(response as Response);
    }
    expect(db.getWebSession).not.toHaveBeenCalled();
  });

  it("refuses duplicate/malformed cookies instead of choosing an identity", async () => {
    const first = await login(), second = await login({ address: wallets[1].address });
    for (const cookie of [`keryx_session=${first.token}; keryx_session=${second.token}`, "keryx_session=garbage", "keryx_session=", "keryx_session", "x=" + "x".repeat(16_384)]) {
      const response = await adapter().authenticate(request(undefined, undefined, { Cookie: cookie }));
      expect((response as Response).status).toBe(401);
    }
    expect(db.getWebSession).not.toHaveBeenCalled();
  });

  it("requires all four original durable fields exactly; missing/deleted and case-substituted rows refuse", async () => {
    const l = await login();
    for (const row of [null, { ...l.row, hash: "f".repeat(64) }, { ...l.row, wallet: wallets[1].address.toLowerCase() },
      { ...l.row, wallet: l.row.wallet.toUpperCase() }, { ...l.row, issuedAt: l.row.issuedAt + 1000 }, { ...l.row, expiresAt: l.row.expiresAt + 1000 }]) {
      const read = vi.fn(async () => row), facade = { getWebSession: read };
      Object.defineProperty(facade, "accountMembership", { value: store });
      const response = await adapter(facade).authenticate(request(l.token));
      expect((response as Response).status).toBe(401); expect(read).toHaveBeenCalledExactlyOnceWith(l.row.hash);
    }
    raw.prepare("DELETE FROM web_sessions WHERE hash=?").run(l.row.hash);
    expect((await routes().GET(request(l.token))).status).toBe(401);
  });

  it("refuses missing, inherited, enumerable, malformed and throwing capabilities without business IO or initialization", async () => {
    const l = await login(), read = vi.fn(async () => l.row), init = vi.fn(() => { throw new Error("Must not initialize"); });
    const inherited = Object.create({ accountMembership: store }) as Facade; inherited.getWebSession = read;
    const malformed = { getWebSession: read }; Object.defineProperty(malformed, "accountMembership", { value: { resolve: () => null } });
    const unavailable = { getWebSession: read }; Object.defineProperty(unavailable, "accountMembership", { get: () => undefined });
    const broken = { getWebSession: read }; Object.defineProperty(broken, "accountMembership", { get: () => { throw new Error("Store unavailable"); } });
    for (const facade of [{ getWebSession: read, init }, inherited, { getWebSession: read, accountMembership: store }, malformed, unavailable, broken]) {
      const response = await adapter(facade as Facade).authenticate(request(l.token));
      expect((response as Response).status).toBe(503); assertPrivate(response as Response);
    }
    expect(read).not.toHaveBeenCalled(); expect(init).not.toHaveBeenCalled();
  });

  it("refuses missing/weak secret, invalid fixed origin/network and request-origin/path/query/method confusion before storage", async () => {
    const l = await login();
    for (const override of [{ jwtSecret: "" }, { jwtSecret: "short" }, { origin: `${origin}/path` }, { origin: "http://foreign.example" }, { network: "eip155:1" }]) {
      const configured = createAccountRequestAdapter({ db, origin, network, jwtSecret: secret, ...override } as Parameters<typeof createAccountRequestAdapter>[0]);
      expect((await configured.authenticate(request(l.token)) as Response).status).toBe(503);
    }
    for (const requestUrl of ["https://foreign.example/api/account/membership", `${url}?account=foreign`, `${origin}/api/account/other`])
      expect((await adapter().authenticate(request(l.token, undefined, { Host: "keryx.example", "X-Forwarded-Host": "keryx.example" }, requestUrl)) as Response).status).toBe(400);
    expect((await adapter().authenticate(request(l.token, undefined, { Origin: "https://foreign.example" })) as Response).status).toBe(403);
    expect((await adapter().authenticate(request(l.token, {}, { Origin: "https://foreign.example" })) as Response).status).toBe(403);
    expect((await adapter().authenticate(new Request(url, { method: "POST", headers: { Cookie: `keryx_session=${l.token}` } })) as Response).status).toBe(403);
    expect((await adapter().authenticate(new Request(url, { method: "PUT", headers: { Cookie: `keryx_session=${l.token}` } })) as Response).status).toBe(405);
    expect(db.getWebSession).not.toHaveBeenCalled();
  });

  it("withholds authority on durable outage, abort or expiry during the awaited read", async () => {
    const l = await login(), read = vi.fn(async (): Promise<WebSessionRecord> => { throw new Error("Offline storage"); });
    const facade = { getWebSession: read }; Object.defineProperty(facade, "accountMembership", { value: store });
    expect((await adapter(facade).authenticate(request(l.token)) as Response).status).toBe(503);
    const abort = new AbortController(), aborted = new Request(url, { headers: { Cookie: `keryx_session=${l.token}` }, signal: abort.signal });
    abort.abort(); expect((await adapter(facade).authenticate(aborted) as Response).status).toBe(400);
    expect(read).toHaveBeenCalledTimes(1);
    const during = new AbortController(), pending = new Request(url, { headers: { Cookie: `keryx_session=${l.token}` }, signal: during.signal });
    read.mockImplementation(async () => { during.abort(); return l.row; });
    expect((await adapter(facade).authenticate(pending) as Response).status).toBe(400);
    read.mockImplementation(async () => { vi.spyOn(Date, "now").mockReturnValue(l.row.expiresAt); return l.row; });
    expect((await adapter(facade).authenticate(request(l.token)) as Response).status).toBe(401);
  });

  it("enforces HTTP consent/wallet preconditions and does not accept client account/session selectors", async () => {
    const l = await login(), r = routes();
    const missingWallet = request(l.token, { action: "prepare-create", consent }); missingWallet.headers.delete("x-keryx-expected-wallet");
    expect((await r.POST(missingWallet)).status).toBe(428);
    expect((await r.POST(request(l.token, { action: "prepare-create", consent }, { "X-Keryx-Expected-Wallet": wallets[1].address }))).status).toBe(409);
    for (const input of [{ action: "prepare-create", consent: { ...consent, shareOwnedHistory: false } },
      { action: "prepare-create", consent, sessionHash: l.row.hash }, { action: "prepare-create", consent, accountId: `acct_${"f".repeat(64)}` }])
      expect((await r.POST(request(l.token, input))).status).toBe(400);
    expect((await r.POST(new Request(url, { method: "POST", headers: { Origin: origin, "Content-Type": "text/plain" }, body: "bad" }))).status).toBe(400);
    expect(raw.prepare("SELECT count(*) AS n FROM account267_challenges").get()?.n).toBe(0);
  });

  it("composes create/link/resume/unlink with real stored lineage and refuses an unlinked login despite a valid JWT", async () => {
    const first = await login(), second = await login({ address: wallets[1].address }), r = routes();
    const prepared = await r.POST(request(first.token, { action: "prepare-create", consent })); expect(prepared.status).toBe(200);
    const createProof = await prepared.json();
    const created = await r.POST(request(first.token, { action: "complete-create", nonce: createProof.nonce, consent })); expect(created.status).toBe(200);
    let membership = (await created.json()).membership as Membership;
    const otherNetwork = createOrdinaryAccountMembershipRoutes({ db, origin, network: "eip155:5042", jwtSecret: secret });
    expect((await otherNetwork.GET(request(first.token))).status).toBe(401);
    expect((await r.POST(request(first.token, { action: "complete-create", nonce: createProof.nonce, consent }))).status).toBe(400);
    const link = await r.POST(request(first.token, { action: "prepare-link", expected: expectedOf(membership), wallet: wallets[1].address, consent: linkConsent }));
    expect(link.status).toBe(200); const proof = await link.json();
    const signature = await wallets[1].signMessage({ message: proof.message });
    const linked = await r.POST(request(first.token, { action: "complete-link", nonce: proof.nonce, signature, consent: linkConsent })); expect(linked.status).toBe(200);
    membership = (await linked.json()).membership as Membership;
    // Pre-link original login cannot resume the new credential, even with a signed cookie.
    const secondHeader = { "X-Keryx-Expected-Wallet": wallets[1].address };
    expect((await r.POST(request(second.token, { action: "resume", expected: expectedOf(membership), consent }, secondHeader))).status).toBe(401);
    // Wait only for the real persisted strictly-next-second boundary; do not mock
    // the account store's independent SQLite transaction clock or renew a login.
    const loginAfter = Number(raw.prepare("SELECT login_after FROM account267_credentials WHERE wallet=?").get(wallets[1].address.toLowerCase())?.login_after);
    await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, loginAfter - Date.now()) + 10));
    const fresh = await login({ address: wallets[1].address });
    const resumed = await r.POST(request(fresh.token, { action: "resume", expected: expectedOf(membership), consent }, secondHeader));
    expect(resumed.status).toBe(200);
    const observed = await r.GET(request(fresh.token)); expect(observed.status).toBe(200); assertPrivate(observed);
    expect((await observed.json()).membership).toEqual(membership);
    const target = membership.members.find(m => m.wallet === wallets[1].address.toLowerCase())!;
    const removed = await r.POST(request(first.token, { action: "unlink", expected: expectedOf(membership), wallet: target.wallet, generation: target.generation, consent: true }));
    expect(removed.status).toBe(200);
    expect((await r.GET(request(fresh.token))).status).toBe(401);
    expect(await db.getWebSession(fresh.row.hash)).toEqual(fresh.row); // Wallet login is not rewritten by account unlink.
    expect(raw.prepare("SELECT revoked_at FROM account267_sessions WHERE session_hash=?").get(fresh.row.hash)?.revoked_at).not.toBeNull();
  });
});
