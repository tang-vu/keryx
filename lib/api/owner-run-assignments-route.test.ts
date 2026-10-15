/** AUTHORED, UNRUN. One disposable, explicitly SYNTHETIC native fixture.
 * Exercises ordinary mounted source after parent composition, never output modules.
 * This is not SIWE enrollment, genuine owner apply, custody or payment evidence. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KeryxDB, WebSessionRecord } from "../db/keryx-db";
import type { StorageIdentity } from "../db/storage-identity";
import type { Manifest, OwnerAction, Recipient } from "../owner-run-assignments/contracts";

const origin = "https://assignment.invalid", url = `${origin}/api/me/run-assignments`;
const wallet = `0x${"a".repeat(40)}`, otherWallet = `0x${"b".repeat(40)}`;
const jti = "c".repeat(64), memberGeneration = "d".repeat(64), credentialGeneration = "f".repeat(64);
const secret = "PUBLIC-SYNTHETIC-OWNER269-MOUNTED-COOKIE-TEST-ONLY";
const requestId = "26900000-0000-4000-8000-000000000004";
const assignmentId = "26900000-0000-4000-8000-000000000005";
const applyId = "26900000-0000-4000-8000-000000000006";
const caller = new AsyncLocalStorage<Request>();
const cookieDelivery = vi.fn(), selectedDb = vi.fn();
const protectedTables = ["query_runs", "payment_events", "session_grants", "browser_authorization_intents",
  "a2a_orders", "anonymous_run_claims", "run_privacy"] as const;
let directory: string | undefined, file: string, deploymentFile: string;
let db: (KeryxDB & { close(): void }) | undefined;
let routes: typeof import("../../app/api/me/run-assignments/route");
let accountSessionContext: typeof import("../account-sessions")["accountSessionContext"];
let canonicalJson: typeof import("../canonical-json")["canonicalJson"];
let inboxSchema: typeof import("../owner-run-assignments/projection")["inboxSchema"];
let identity: StorageIdentity, row: WebSessionRecord, recipient: Recipient, manifest: Manifest;
let token: string | undefined, protectedBefore: string, schemaBefore: string;
let edit: (action: (native: DatabaseSync) => void) => void;

function inspect<T>(action: (native: DatabaseSync) => T): T {
  const native = new DatabaseSync(file, { readOnly: true });
  try { return action(native); } finally { native.close(); }
}
const snapshot = (tables: readonly string[]) => inspect(native => canonicalJson(tables.map(table =>
  [table, native.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])));
const journal = () => snapshot(["owner269_operations", "owner269_associations"]);
const schema = () => inspect(native => canonicalJson(native.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name").all()));
const consent = () => ({ expected: recipient, input: { action: "consent", requestId, manifest,
  acknowledgeAssignedLabel: true, noFinancialAuthority: true } });
async function sign(options: { signingSecret?: string; sessionId?: string; expiresAt?: number; role?: "asker" | "dev" } = {}) {
  return new SignJWT({ address: wallet, role: options.role ?? "asker" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer("keryx-web").setAudience("keryx-account")
    .setJti(options.sessionId ?? jti).setIssuedAt(row.issuedAt / 1000).setExpirationTime((options.expiresAt ?? row.expiresAt) / 1000)
    .sign(new TextEncoder().encode(options.signingSecret ?? secret));
}
function request(method: "GET" | "POST", body: unknown = consent(), headers: Record<string, string> = {}) {
  return new Request(url, { method, headers: { origin, "sec-fetch-site": "same-origin", "x-keryx-expected-wallet": wallet,
    ...(token ? { cookie: `keryx_session=${token}` } : {}),
    ...(method === "POST" ? { "content-type": "application/json" } : {}), ...headers },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
const dispatch = (req: Request) => caller.run(req, () => req.method === "GET" ? routes.GET(req) : routes.POST(req));
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}
async function refuse(req: Request, status: number, error: string) {
  const before = journal(), response = await dispatch(req);
  expect(response.status).toBe(status); privateHeaders(response);
  expect(await response.json()).toEqual({ error });
  expect(journal()).toBe(before);
}

beforeEach(async () => {
  // Real beforeEach, canonical 20s Windows / 10s other test AND hook bounds.
  // No test/hook timeout, clock, native policy or database admission override.
  vi.resetModules(); cookieDelivery.mockReset(); selectedDb.mockReset();
  db = undefined; directory = undefined; token = undefined;
  cookieDelivery.mockImplementation(async () => {
    const req = caller.getStore();
    if (!req) throw new Error("Synthetic request delivery requires its caller");
    // Infrastructure adapter only: the actual Request carries the signed cookie,
    // and Next's real cookie reader delivers it to the unchanged session parser.
    return new NextRequest(req.url, { headers: req.headers }).cookies;
  });
  vi.doMock("next/headers", () => ({ cookies: cookieDelivery }));
  vi.doMock("@/lib/db", () => ({ getDb: selectedDb }));
  vi.doMock("@/lib/config", async () => {
    const { ARC_MAINNET_PROFILE } = await import("../arc-network-profile");
    return { config: { baseUrl: origin, jwtSecret: secret, profile: ARC_MAINNET_PROFILE } };
  });
  // Ordinary source imports share this module epoch, including private native
  // provenance. No parser/context/port/WeakMap capability is replaced or invented.
  ({ canonicalJson } = await import("../canonical-json"));
  const { webSessionHash } = await import("../auth-session");
  const { STORAGE_MAINNET_PROFILE_DIGEST, storageIdentityDigest, validateStorageIdentity } = await import("../db/storage-identity");
  const { installMainnetApplicationSchema } = await import("../db/mainnet-application-schema");
  const { installNativeUserDomainSchema, NATIVE_USER_DOMAIN_TABLES } = await import("../db/native-user-domain-schema");
  const { insertStorageIdentity, installStorageFences } = await import("../db/storage-identity-sqlite");
  const { supportedSqliteApplicationProfiles } = await import("../db/enrolled-sqlite-schema-profile");
  const { openVerifiedSqliteStorage } = await import("../db/storage-identity-connection");
  directory = mkdtempSync(join(tmpdir(), "keryx-mounted-owner269-"));
  file = join(directory, "synthetic.sqlite"); deploymentFile = join(directory, "deployment.json");
  const now = Math.floor(Date.now() / 1000) * 1000;
  identity = validateStorageIdentity({ format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real", network: "eip155:5042",
    deploymentId: "26900000-0000-4000-8000-000000000001", storageId: "26900000-0000-4000-8000-000000000002",
    enrollmentId: "26900000-0000-4000-8000-000000000003", enrolledAt: "2026-10-01T00:00:00.000Z",
    profileDigest: STORAGE_MAINNET_PROFILE_DIGEST, provenanceDigest: "a".repeat(64) });
  row = { hash: webSessionHash(jti), wallet, issuedAt: now - 2000, expiresAt: now + 3_600_000 };
  recipient = { accountId: `acct_${"a".repeat(64)}`, accountCreatedAt: now - 100_000, wallet, memberGeneration };
  const completedAt = new Date(now - 200_000).toISOString(), runId = "synthetic_owner269_mounted";
  const original = canonicalJson({ id: runId, createdAt: completedAt, question: "SYNTHETIC", answer: "SYNTHETIC",
    decisions: [], citations: [], trace: [], subClaims: [], budget: 0, engine: "heuristic", totalSpent: 0,
    totalToCreators: 0, fundingOwner: "offline", paymentMode: "offline" });
  manifest = { version: 1, binding: { storageDigest: storageIdentityDigest(identity), network: identity.network, origin }, recipient,
    basis: { code: "early-run-recovery", reference: "synthetic-only" }, scope: "association-history-and-confirmation",
    admissionExpiresAt: now + 3_600_000,
    members: [{ assignmentId, runId, completedAt, originalSha256: createHash("sha256").update(original).digest("hex") }] };
  const raw = new DatabaseSync(file);
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    installMainnetApplicationSchema(raw); installNativeUserDomainSchema(raw);
    // ALL raw fixture rows are explicitly synthetic and precede enrollment/fences.
    // No imported owner event/association or fabricated owner authorization exists.
    raw.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(row.hash, wallet, row.issuedAt, row.expiresAt);
    raw.prepare("INSERT INTO account267_accounts VALUES(?,?,?)").run(recipient.accountId, 1, recipient.accountCreatedAt);
    raw.prepare("INSERT INTO account267_members VALUES(?,?,?,?,?)")
      .run(wallet, recipient.accountId, memberGeneration, "e".repeat(64), recipient.accountCreatedAt);
    raw.prepare("INSERT INTO account267_credentials VALUES(?,?,?,?,?,?)")
      .run(wallet, recipient.accountId, memberGeneration, credentialGeneration, recipient.accountCreatedAt, 1);
    raw.prepare("INSERT INTO account267_sessions VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(row.hash, wallet, recipient.accountId, memberGeneration, credentialGeneration, row.issuedAt, row.expiresAt, origin, identity.network, 1, null);
    raw.prepare("INSERT INTO query_runs(id,created_at,data) VALUES(?,?,?)").run(runId, completedAt, original);
    raw.prepare("INSERT INTO payment_events(id,query_id,network,settled,settlement_status,amount_usdc,payer,payee) VALUES(?,?,?,0,'simulated',0,?,?)")
      .run("synthetic_owner269_payment", runId, identity.network, otherWallet, `0x${"9".repeat(40)}`);
    insertStorageIdentity(raw, identity); installStorageFences(raw, identity); raw.exec("COMMIT");
  } finally { raw.close(); }
  const deployment = { format: "keryx-storage-deployment-v1", identity, backend: { kind: "sqlite", databasePath: file } };
  const deploymentText = canonicalJson(deployment);
  writeFileSync(deploymentFile, deploymentText, { flag: "wx", mode: 0o600 });
  // Only process-local, restored synthetic fixture selectors; no .env loader or
  // provider settings. The real manifest reader, opener and fixed policies run.
  vi.stubEnv("KERYX_STORAGE_MANIFEST", deploymentFile); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", "ab".repeat(32));
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false"); vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  vi.stubEnv("KERYX_PUBLIC_PROFILES_ENABLED", "false");
  const { readRuntimeStorageDeployment } = await import("../db/runtime-storage-config");
  const runtimeGuard = () => {
    if (canonicalJson(readRuntimeStorageDeployment()) !== deploymentText) throw new Error("Synthetic deployment changed");
  };
  edit = action => {
    // Post-enrollment changes use a genuinely verified, fenced fixture actor.
    // It simulates external lineage invalidation, not POSIX owner authority.
    const connection = openVerifiedSqliteStorage(file, identity, { runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    try {
      connection.db.exec("BEGIN IMMEDIATE"); action(connection.db); connection.db.exec("COMMIT");
    } finally {
      try { if (connection.db.isTransaction) connection.db.exec("ROLLBACK"); } finally { connection.close(); }
    }
  };
  protectedBefore = snapshot(protectedTables); schemaBefore = schema();
  expect(NATIVE_USER_DOMAIN_TABLES).toHaveLength(24);
  expect(supportedSqliteApplicationProfiles(true)).toHaveLength(4);
  const { createEnrolledSqliteAdapter, assertEnrolledSqliteAdapter } = await import("../db/enrolled-sqlite-adapter");
  db = await createEnrolledSqliteAdapter();
  expect(assertEnrolledSqliteAdapter(db, "write")).toEqual(identity);
  expect(Object.isFrozen(db)).toBe(true);
  expect(Object.getOwnPropertyDescriptor(db, "ownerRunAssignments"))
    .toMatchObject({ enumerable: false, writable: false, configurable: false });
  expect(Object.keys(db.ownerRunAssignments!).sort()).toEqual(["act", "reply"]);
  expect(await db.getWebSession(row.hash)).toEqual(row);
  selectedDb.mockImplementation(async (): Promise<KeryxDB> => {
    if (!db) throw new Error("Synthetic selected facade closed");
    return db;
  });
  token = await sign();
  ({ inboxSchema } = await import("../owner-run-assignments/projection"));
  ({ accountSessionContext } = await import("../account-sessions"));
  routes = await import("../../app/api/me/run-assignments/route");
});
afterEach(() => {
  try {
    if (db) { expect(snapshot(protectedTables)).toBe(protectedBefore); expect(schema()).toBe(schemaBefore); }
  } finally {
    try { db?.close(); } finally {
      db = undefined; token = undefined;
      vi.doUnmock("next/headers"); vi.doUnmock("@/lib/db"); vi.doUnmock("@/lib/config");
      vi.unstubAllEnvs(); vi.resetModules(); cookieDelivery.mockReset(); selectedDb.mockReset();
      if (directory) {
        const target = resolve(directory), root = resolve(tmpdir()) + sep;
        if (!target.startsWith(root) || !target.slice(root.length).startsWith("keryx-mounted-owner269-")
          || target.slice(root.length).includes(sep)) throw new Error("Unsafe synthetic fixture cleanup");
        rmSync(target, { recursive: true, force: true }); directory = undefined;
      }
    }
  }
});

describe("mounted owner269 cookie + durable + native composition (authored UNRUN)", () => {
  it("reads the genuine recipient and records consent through real caller/context and the mounted route", async () => {
    const contextRequest = request("GET");
    const context = await caller.run(contextRequest, accountSessionContext);
    if (context instanceof Response) throw new Error("Expected synthetic durable account context");
    expect(context.db).toBe(db); expect(context.wallet).toBe(wallet); expect(context.currentId).toBe(row.hash);
    const before = journal(), get = await dispatch(request("GET"));
    expect(get.status).toBe(200); privateHeaders(get);
    expect(inboxSchema.parse(await get.json())).toEqual({ version: 1, kind: "owner-assignment-inbox", recipient,
      history: [], profile: { assignedByOwner: 0, claimedFromOwnerAssignment: 0 } });
    expect(journal()).toBe(before);
    const response = await dispatch(request("POST")), text = await response.text();
    expect(response.status).toBe(200); privateHeaders(response);
    for (const privateValue of [token!, secret, jti, row.hash]) expect(text.includes(privateValue)).toBe(false);
    const inbox = inboxSchema.parse(JSON.parse(text));
    expect(inbox.recipient).toEqual(recipient); expect(inbox.history).toEqual([]);
    expect(inbox.receipt).toMatchObject({ version: 1, requestId, action: "consent", results: [],
      meaning: "historical-committed-result-not-current-authority" });
    const stored = inspect(native => native.prepare("SELECT request_id,input_digest,event FROM owner269_operations").all());
    expect(stored).toHaveLength(1);
    const { eventSchema } = await import("../owner-run-assignments/contracts");
    const event = eventSchema.parse(JSON.parse(String(stored[0].event)));
    expect(event.actor).toEqual(recipient); expect(event.credentialGeneration).toBe(credentialGeneration);
    expect(event.input).toEqual(consent().input); expect(event.receipt).toEqual(inbox.receipt);
    expect(stored[0].request_id).toBe(requestId); expect(stored[0].input_digest).toBe(event.inputDigest);
    expect(inspect(native => native.prepare("SELECT count(*) AS n FROM owner269_associations").get()?.n)).toBe(0);
  });
  it.each(["missing-cookie", "invalid-signature", "expired-cookie", "unrecorded-cookie", "revoked-web-session", "revoked-account-session"] as const)
    ("refuses %s on mounted GET and consent before journal mutation", async mode => {
      if (mode === "missing-cookie") token = undefined;
      if (mode === "invalid-signature") token = await sign({ signingSecret: `${secret}-foreign` });
      if (mode === "expired-cookie") token = await sign({ expiresAt: row.issuedAt + 1000 });
      if (mode === "unrecorded-cookie") token = await sign({ sessionId: "8".repeat(64) });
      if (mode === "revoked-web-session") await db!.revokeWebSession(row.hash, wallet);
      if (mode === "revoked-account-session") edit(native => {
        native.prepare("UPDATE account267_sessions SET revoked_at=? WHERE session_hash=?").run(Date.now(), row.hash);
      });
      for (const method of ["GET", "POST"] as const) await refuse(request(method), 401, "assignment_unauthenticated");
      if (["missing-cookie", "invalid-signature", "expired-cookie"].includes(mode)) expect(selectedDb).not.toHaveBeenCalled();
      else expect(selectedDb).toHaveBeenCalled();
    });
  it.each([
    ["Bearer", { authorization: "Bearer synthetic-api-key" }, 401, "assignment_unauthenticated"],
    ["cross-origin", { origin: "https://attacker.invalid" }, 403, "same_origin_required"],
    ["cross-site", { "sec-fetch-site": "cross-site" }, 403, "same_origin_required"],
  ] as const)("refuses %s despite a valid cookie before even cookie/DB delivery", async (_name, headers, status, error) => {
    for (const method of ["GET", "POST"] as const) await refuse(request(method, consent(), headers), status, error);
    expect(cookieDelivery).not.toHaveBeenCalled(); expect(selectedDb).not.toHaveBeenCalled();
  });
  it("refuses a wrong current-wallet precondition for GET and consent", async () => {
    for (const method of ["GET", "POST"] as const)
      await refuse(request(method, consent(), { "x-keryx-expected-wallet": otherWallet }), 409, "assignment_conflict");
    expect(selectedDb).toHaveBeenCalled();
  });
  it("refuses an expected recipient generation mismatch under a valid current native session", async () => {
    await refuse(request("POST", { ...consent(), expected: { ...recipient, memberGeneration: "8".repeat(64) } }), 409, "assignment_conflict");
  });
  it.each(["member", "credential"] as const)("refuses replaced current %s lineage behind an unchanged valid cookie", async mode => {
    edit(native => {
      if (mode === "member") {
        native.prepare("UPDATE account267_members SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
        native.prepare("UPDATE account267_credentials SET member_generation=? WHERE wallet=?").run("8".repeat(64), wallet);
      } else native.prepare("UPDATE account267_credentials SET generation=? WHERE wallet=?").run("8".repeat(64), wallet);
    });
    expect(await db!.getWebSession(row.hash)).toEqual(row);
    for (const method of ["GET", "POST"] as const) await refuse(request(method), 401, "assignment_unauthenticated");
  });
  it.each(["apply", "undo", "cleanup"] as const)("never grants owner %s from even a real signed dev-role browser session", async action => {
    token = await sign({ role: "dev" });
    const input: OwnerAction = action === "apply" ? { action, requestId, manifest, consentId: applyId }
      : { action, requestId, applyId, expected: [{ assignmentId, revision: 1 }] };
    expect(db!.ownerRunAssignments).not.toHaveProperty("owner");
    await refuse(request("POST", { expected: recipient, input }), 400, "invalid_assignment_request");
  });
  it("rechecks real durable revocation while the bounded consent body is awaited", async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(done => { enter = done; }), released = new Promise<void>(done => { release = done; });
    const bytes = new TextEncoder().encode(JSON.stringify(consent()));
    const stream = new ReadableStream<Uint8Array>({ async pull(controller) {
      enter(); await released; controller.enqueue(bytes); controller.close();
    } }, { highWaterMark: 0 });
    const base = request("POST"), before = journal();
    const req = new Request(url, { method: "POST", headers: base.headers, body: stream, duplex: "half" } as RequestInit);
    const running = dispatch(req);
    try {
      await Promise.race([entered, running.then(() => { throw new Error("Mounted route did not reach its consent body"); })]);
      await db!.revokeWebSession(row.hash, wallet);
    } finally { release(); }
    const response = await running;
    expect(response.status).toBe(401); privateHeaders(response);
    expect(await response.json()).toEqual({ error: "assignment_unauthenticated" });
    expect(journal()).toBe(before);
  });
});
