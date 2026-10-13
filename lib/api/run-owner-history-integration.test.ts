import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { issueWebSession } from "../auth-session";
import type { AgentDeps } from "../agent/deps";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { QueryRun } from "../types";
import type { SettleInfo } from "../x402-server";

// Actual POST -> collectRun -> runAgent/newRunProvenance -> SQLite writer/readers
// -> session-authenticated /api/me/asks. No replacement collector, owner resolver,
// provenance builder, save function, history selector or session verifier.
// Dependency selection supplies the existing offline engine and an empty catalog;
// the genuine pipeline completes with an honest no-evidence answer. External
// admission/model selection/discovery/payment transports are controlled below.
// The A2A callback is SYNTHETIC already-verified settlement input, never live
// payment verification or mainnet acceptance. Its inbound row exists only here.
const boundary = vi.hoisted(() => ({
  db: vi.fn(), deps: vi.fn(), cookies: vi.fn(), sponsored: vi.fn(),
  settle: vi.fn(), rateLimit: vi.fn(), outbound: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/agent/deps", () => ({ getAgentDeps: boundary.deps }));
vi.mock("next/headers", () => ({ cookies: boundary.cookies }));
vi.mock("@/lib/llm", () => ({ resolveModelChoice: () => undefined }));
vi.mock("@/lib/sponsored-admission", () => ({ checkSponsoredResearchAdmission: boundary.sponsored }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: boundary.rateLimit, clientIp: () => "192.0.2.26" }));
vi.mock("@/lib/x402-server", () => ({ settleThenServe: boundary.settle,
  challengeResponse: () => { throw Error("Unexpected payment challenge in offline history fixture"); } }));
vi.mock("@/lib/research/availability", () => ({
  readResearchAvailability: () => ({ state: "not-paused", message: "Offline fixture admission" }),
}));
vi.mock("@/lib/research/paid-admission", () => ({ paidResearchAdmissionResponse: () => null }));
vi.mock("@/lib/business-operator/canary-paid-admission", () => ({ businessCanaryPaidAdmission: () => null }));
// Do not consult or consume a retained live allowance/canary from this fixture.
vi.mock("@/lib/business-operator/canary-policy", async original => ({
  ...await original<typeof import("../business-operator/canary-policy")>(),
  admitBusinessCanaryRun: () => null, canaryExecutionPaused: () => false,
}));
vi.mock("@/lib/research/research-allowance", async original => ({
  ...await original<typeof import("../research/research-allowance")>(), admitBoundedResearch: () => null,
}));
vi.mock("@/lib/config", async () => ({ config: {
  profile: (await import("../arc-network-profile")).ARC_TESTNET_PROFILE,
  network: "arcTestnet", networkId: "eip155:5042002", baseUrl: "https://owner-history.example",
  sellerAddress: `0x${"2".repeat(40)}`, funderKey: "synthetic-not-a-signing-key", botKey: "",
  jwtSecret: "synthetic-owner-history-secret-with-no-live-authority", devWallets: [],
  defaultBudget: 0.05, anonMaxBudget: 0.03, a2aMaxBudget: 0.5, a2aFeeUsdc: 0.02, a2aDeepFeeUsdc: 0.05,
  citationPoolRatio: 0.5, maxAttentionSources: 2, reevaluateRounds: 0,
  cacheTtlSeconds: 60, minCacheExpectedValue: 0.45, minPublicReadExpectedValue: 0.12,
  webSearchProvider: "", tavilyApiKey: "", registryAddress: "", registryReadAddress: "",
} }));

import { POST as openaiPost } from "../../app/api/v1/chat/completions/route";
import { POST as a2aPost } from "../../app/api/agent/ask/route";
import { GET as walletHistory } from "../../app/api/me/asks/route";
import { verifyApiKey } from "../api-keys";
import { quoteA2aResearch } from "../a2a/pricing";

const KEY_OWNER = `0x${"a".repeat(40)}`, PAYER = `0x${"b".repeat(40)}`, FOREIGN = `0x${"c".repeat(40)}`;
const RAW_KEY = `kx_live_${"1".repeat(96)}`, MISSING_KEY = `kx_live_${"3".repeat(96)}`;
const KEY_HASH = createHash("sha256").update(RAW_KEY).digest("hex");
const SECRET = "synthetic-owner-history-secret-with-no-live-authority";
const QUESTION = "Explain the synthetic owner history fixture";
const API_PROVENANCE = { version: 1, surface: "api", ownershipMethod: "api-key" } as const;
const PAYER_PROVENANCE = { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } as const;
const UNKNOWN_PROVENANCE = { version: 1, surface: "api", ownershipMethod: "unknown" } as const;
const sessionCookie = new AsyncLocalStorage<string | undefined>();
let db: SqliteAdapter, connection: DatabaseSync, engine: HeuristicEngine, gateway: PaymentGateway;
let keyId: string, ownerToken: string, payerToken: string, foreignToken: string, settlement: SettleInfo;
let save: MockInstance<SqliteAdapter["saveQueryRun"]>;
let decompose: MockInstance<HeuristicEngine["decompose"]>;

function legacyRun(id: string, asker?: string): QueryRun {
  return { id, question: `Retained ${id}`, asker, origin: "web", engine: "heuristic", budget: 0,
    subClaims: [], decisions: [], citations: [], trace: [], answer: "Retained unknown provenance",
    totalSpent: 0, totalToCreators: 0, createdAt: "2026-10-09T00:00:00.000Z", paymentMode: "offline" };
}
const retainedRuns = [legacyRun("legacy-owned", KEY_OWNER), legacyRun("legacy-unowned")];
let retainedRows: unknown[];
const rows = () => connection.prepare("SELECT id,asker,data FROM query_runs ORDER BY id").all();
const count = (table: "query_runs" | "a2a_orders" | "payment_events" | "cache_items") =>
  Number(connection.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);

beforeEach(async () => {
  vi.resetAllMocks();
  // Only the signed A2A handler's existing testnet availability guard needs 0;
  // dependency injection always supplies SYNTHETIC/no-signing transports.
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0");
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "false");
  vi.stubEnv("KERYX_ANONYMOUS_RUN_CLAIMS_ENABLED", "false");
  db = new SqliteAdapter(":memory:");
  connection = Reflect.get(db, "db") as DatabaseSync;
  // Existing fixture schema only, on this new in-memory connection. No init,
  // enrollment, optional rollout schema, shared DB or filesystem database.
  installSqliteApplicationSchema(connection);
  boundary.db.mockResolvedValue(db);
  keyId = (await db.mintApiKey(KEY_OWNER, RAW_KEY.slice(0, 16), KEY_HASH, "offline-owner-history", "ask")).id;
  ownerToken = (await issueWebSession(db, SECRET, KEY_OWNER, "asker")).token;
  payerToken = (await issueWebSession(db, SECRET, PAYER, "asker")).token;
  foreignToken = (await issueWebSession(db, SECRET, FOREIGN, "asker")).token;
  boundary.cookies.mockImplementation(async () => ({ get: (name: string) =>
    name === "keryx_session" && sessionCookie.getStore() ? { value: sessionCookie.getStore() } : undefined }));
  for (const run of retainedRuns) await db.saveQueryRun(run);
  retainedRows = rows();
  save = vi.spyOn(db, "saveQueryRun"); // Observe, do not replace the real writer.
  engine = new HeuristicEngine();
  decompose = vi.spyOn(engine, "decompose"); // Observe the real offline work.
  gateway = { mode: "offline", agentAddress: () => `0x${"2".repeat(40)}`,
    ensureFunded: vi.fn(async () => { throw Error("Unexpected funding in history fixture"); }),
    payFetch: vi.fn(async () => { throw Error("Unexpected purchase in history fixture"); }),
    payCitation: vi.fn(async () => { throw Error("Unexpected reward in history fixture"); }) };
  const deps: AgentDeps = { db, engine, gateway, discoverExternal: async () => [] };
  boundary.deps.mockResolvedValue(deps);
  boundary.sponsored.mockResolvedValue(null);
  boundary.rateLimit.mockResolvedValue(null);
  const quote = quoteA2aResearch(0.05, "quick");
  settlement = { payer: PAYER, transaction: "synthetic-settlement-not-chain-evidence", network: "eip155:5042002",
    authorizationId: `0x${"4".repeat(64)}`, amountUsdc: quote.totalPriceUsdc };
  boundary.settle.mockImplementation(async (_req, _options, produce) => {
    const result = await produce(settlement);
    return result instanceof Response ? result : Response.json(result);
  });
  boundary.outbound.mockImplementation(() => { throw Error("Outbound transport forbidden in offline history fixture"); });
  vi.stubGlobal("fetch", boundary.outbound);
});
afterEach(() => {
  try {
    expect(boundary.outbound).not.toHaveBeenCalled();
    for (const operation of [gateway.ensureFunded, gateway.payFetch, gateway.payCitation])
      expect(operation).not.toHaveBeenCalled();
    expect(count("cache_items")).toBe(0);
    // Raw originals and their indexed authority remain byte-equal, including
    // absent provenance. An old web origin does not become a new session proof.
    expect(rows().filter(row => String(row.id).startsWith("legacy-"))).toEqual(retainedRows);
  } finally { db.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); }
});

function headers(key: string | null) {
  return { "content-type": "application/json", ...(key === null ? {} : { authorization: `Bearer ${key}` }),
    "x-api-key": RAW_KEY, "x-wallet-address": FOREIGN, "x-payer": FOREIGN,
    "cf-connecting-ip": "192.0.2.26", "x-keryx-client": "desktop",
    "user-agent": `forged-desktop-${FOREIGN}`, "payment-signature": "synthetic-unverified-envelope" };
}
const forged = { asker: FOREIGN, payer: FOREIGN, walletAddress: FOREIGN, mcpClient: "desktop",
  fundingOwner: "browser", askerFunded: true,
  provenance: { version: 1, surface: "desktop", ownershipMethod: "session" } };
function openaiRequest(stream: boolean, key: string | null = RAW_KEY) {
  return new NextRequest("https://owner-history.example/api/v1/chat/completions?client=desktop", {
    method: "POST", headers: headers(key), body: JSON.stringify({
      ...forged, messages: [{ role: "user", content: QUESTION }], model: "keryx", budget: 0, stream,
    }),
  });
}
async function openaiResult(response: Response, stream: boolean) {
  expect(response.status).toBe(200);
  const wire = await response.text();
  if (!stream) { const body = JSON.parse(wire); return { id: body.keryx.queryId as string, body, wire }; }
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(wire.endsWith("data: [DONE]\n\n")).toBe(true);
  const chunks = wire.split("\n\n").filter(part => part.startsWith("data: {"))
    .map(part => JSON.parse(part.slice(6)));
  expect(chunks.some(chunk => chunk.choices[0].delta.reasoning_content?.includes("[decompose]"))).toBe(true);
  const body = chunks.at(-1);
  expect(body.choices[0].finish_reason).toBe("stop");
  return { id: body.keryx.queryId as string, body, wire };
}
const readHistory = (token?: string, extraHeaders: Record<string, string> = {}) => sessionCookie.run(token,
  () => walletHistory(new NextRequest(`https://owner-history.example/api/me/asks?view=recent&wallet=${FOREIGN}&limit=200`,
    { headers: extraHeaders })));
async function assertPrivateHistory(id: string, owner: string, token: string, provenance: QueryRun["provenance"]) {
  const response = await readHistory(token);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(body.wallet).toBe(owner);
  expect(body.asks.filter((row: { id: string }) => row.id === id)).toEqual([expect.objectContaining({
    id, question: QUESTION, provenance, funded: false, spentUsdc: 0, toCreatorsUsdc: 0,
  })]);
  expect(body.asks.map((row: { id: string }) => row.id).sort()).toEqual(
    [...(owner === KEY_OWNER ? ["legacy-owned"] : []), id].sort());
  expect(body.totals.spentUsdc).toBe(0); // Run ownership never adds browser funding authority.
  const foreignResponse = await readHistory(foreignToken);
  expect(foreignResponse.status).toBe(200);
  expect((await foreignResponse.json()).asks).toEqual([]);
  const anonymous = await readHistory();
  expect(anonymous.status).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "unauthenticated" });
  // Ask scope cannot read private history, even with the owner's valid cookie.
  const scoped = await sessionCookie.run(token, () => walletHistory(new NextRequest(
    "https://owner-history.example/api/me/asks?contract=owned&limit=25",
    { headers: { authorization: `Bearer ${RAW_KEY}` } },
  )));
  expect(scoped.status).toBe(403);
  expect(await scoped.json()).toEqual({ error: "insufficient_scope" });
}
async function assertPersistedRun(id: string, owner: string | undefined, provenance: QueryRun["provenance"],
  paymentMode: PaymentGateway["mode"] = "offline") {
  expect(save).toHaveBeenCalledOnce();
  expect(decompose).toHaveBeenCalledExactlyOnceWith(QUESTION);
  expect(count("query_runs")).toBe(retainedRows.length + 1);
  const saved = await db.getQueryRun(id);
  expect(saved).toMatchObject({ id, question: QUESTION, engine: "heuristic", provenance,
    fundingOwner: paymentMode === "real" ? "treasury" : "offline", paymentMode,
    totalSpent: 0, totalToCreators: 0,
    subClaims: [QUESTION], citations: [] });
  expect(saved!.answer.length).toBeGreaterThan(0);
  expect(saved!.trace.at(-1)?.phase).toBe("done");
  expect(saved!.asker).toBe(owner);
  const row = connection.prepare("SELECT asker,data FROM query_runs WHERE id=?").get(id)!;
  expect(row.asker).toBe(owner ?? null);
  expect(JSON.parse(String(row.data)).provenance).toEqual(provenance);
  expect(await db.listQueryRunsByAsker(FOREIGN, 200)).toEqual([]);
  for (const field of ["payer", "walletAddress", "mcpClient"]) expect(saved).not.toHaveProperty(field);
  expect(saved!.askerFunded).not.toBe(true);
}

it.each([false, true])("round trips a verified-key OpenAI run into only its wallet history: stream=%s", async stream => {
  expect(await verifyApiKey(RAW_KEY)).toMatchObject({ walletAddress: KEY_OWNER, keyId, scopes: "ask" });
  const result = await openaiResult(await openaiPost(openaiRequest(stream)), stream);
  await assertPersistedRun(result.id, KEY_OWNER, API_PROVENANCE);
  expect(result.body.keryx.provenance).toEqual(API_PROVENANCE);
  for (const value of [RAW_KEY, KEY_HASH, KEY_OWNER, FOREIGN]) expect(result.wire).not.toContain(value);
  expect(count("a2a_orders")).toBe(0); expect(count("payment_events")).toBe(0);
  await assertPrivateHistory(result.id, KEY_OWNER, ownerToken, API_PROVENANCE);
});

it("round trips the synthetic verified-settlement payer through the actual A2A order/collector/history", async () => {
  // SYNTHETIC no-signing transport input exercises the unchanged real-mode
  // response guard. Shared throwing methods remain asserted unused; this mode
  // tag and fake inbound receipt prove neither settlement nor payer verification.
  const syntheticDeps: AgentDeps = { db, engine, gateway: { ...gateway, mode: "real" },
    discoverExternal: async () => [] };
  boundary.deps.mockResolvedValue(syntheticDeps);
  const request = new NextRequest("https://owner-history.example/api/agent/ask?client=desktop", {
    method: "POST", headers: headers(RAW_KEY), body: JSON.stringify({
      ...forged, question: QUESTION, budget: 0.05, researchMode: "quick", responseMode: "wait",
    }),
  });
  const response = await a2aPost(request);
  expect(response.status).toBe(200);
  const body = await response.json(), id = body.queryId as string;
  expect(body.status).toBe("completed");
  expect(boundary.settle).toHaveBeenCalledOnce();
  await assertPersistedRun(id, PAYER, PAYER_PROVENANCE, "real");
  expect(body.provenance).toEqual(PAYER_PROVENANCE);
  expect(await db.getA2aOrder(id)).toMatchObject({ queryId: id, payer: PAYER, status: "completed",
    transaction: settlement.transaction, resultSavingAt: expect.any(String), paymentStartedAt: null });
  expect(count("a2a_orders")).toBe(1); expect(count("payment_events")).toBe(1);
  const inbound = connection.prepare("SELECT kind,payer,query_id,tx_hash FROM payment_events").get();
  expect(inbound).toMatchObject({ kind: "inbound", payer: PAYER, query_id: id, tx_hash: settlement.transaction });
  expect((await db.listQueryRunsByAsker(KEY_OWNER, 200)).map(run => run.id)).toEqual(["legacy-owned"]);
  expect((await (await readHistory(ownerToken)).json()).asks.map((row: { id: string }) => row.id)).toEqual(["legacy-owned"]);
  await assertPrivateHistory(id, PAYER, payerToken, PAYER_PROVENANCE);
});

it.each([false, true])("persists anonymous API ingress as unknown despite forged payer/client/key headers: stream=%s", async stream => {
  const result = await openaiResult(await openaiPost(openaiRequest(stream, null)), stream);
  await assertPersistedRun(result.id, undefined, UNKNOWN_PROVENANCE);
  expect(result.body.keryx.provenance).toEqual(UNKNOWN_PROVENANCE);
  for (const token of [ownerToken, payerToken, foreignToken]) {
    const response = await readHistory(token); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.asks.some((row: { id: string }) => row.id === result.id)).toBe(false);
  }
  expect((await readHistory()).status).toBe(401);
  expect(count("payment_events")).toBe(0); expect(count("a2a_orders")).toBe(0);
});

it.each([false, true].flatMap(stream => ["revoked", "no-row", "scope-refused"].map(state => ({ stream, state }))))
  ("performs no collector work or research writes for $state keys: stream=$stream", async ({ stream, state }) => {
    let key = RAW_KEY;
    if (state === "revoked") await db.revokeApiKey(keyId, KEY_OWNER);
    if (state === "no-row") key = MISSING_KEY; // Actual verifier returns null, no identity mock.
    if (state === "scope-refused") {
      await db.revokeApiKey(keyId, KEY_OWNER);
      key = `kx_live_${"5".repeat(96)}`;
      await db.mintApiKey(KEY_OWNER, key.slice(0, 16), createHash("sha256").update(key).digest("hex"), "export-only", "export");
    }
    const response = await openaiPost(openaiRequest(stream, key));
    expect(response.status).toBe(state === "scope-refused" ? 403 : 401);
    expect(await response.json()).toMatchObject({ error: { code: state === "scope-refused" ? "insufficient_scope" : "invalid_api_key" } });
    expect(boundary.deps).not.toHaveBeenCalled(); expect(boundary.sponsored).not.toHaveBeenCalled();
    expect(boundary.settle).not.toHaveBeenCalled(); expect(decompose).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
    expect(rows()).toEqual(retainedRows);
    expect(count("payment_events")).toBe(0); expect(count("a2a_orders")).toBe(0);
    // Verified keys may update last_used_at; that established credential metadata
    // is not a research write or a grant of ask/history authority.
  });
