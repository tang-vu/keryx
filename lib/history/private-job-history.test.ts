// UNRUN source fixtures. Synthetic established READ-port data; no DB, funded run or signature acceptance claim.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivateResearchResult } from "../db/private-research-results";
import type { PrivateExecutionClaim } from "../db/private-research-executions";
import type { PrivatePaymentState } from "../a2a/private-payment-state";
import { privatePaymentState } from "../a2a/private-payment-state";
import { privateRequestNonce } from "../buyer/private-request-commitment";
import { BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY } from "../buyer/protocol";
import { readPrivateJobHistory, readPrivateJobHistoryDetail, exportPrivateJobHistory, privateJobHistoryCsv,
  type PrivateJobHistoryDB } from "./private-job-history";
import { PRIVATE_JOB_HISTORY_BOUNDS as B, comparePrivateJobPosition, privateJobHistoryPageSchema, privateJobHistoryDetailSchema,
  type PrivateJobPosition } from "./private-job-history-contract";
import { createPrivateJobHistoryRoute } from "./private-job-history-route";

const alice = `0x${"11".repeat(20)}`, bob = `0x${"22".repeat(20)}`;
const currentId = "a".repeat(64), replacementId = "b".repeat(64);
const rawKey = `kx_live_${"3".repeat(96)}`;
const time = "2026-10-14T00:00:00.123456+00:00";
const hidden = "SYNTHETIC_PRIVATE_INTERNAL_DO_NOT_DELIVER";
const clone = <T>(value: T): T => structuredClone(value);
type Job = { intent: PrivateResearchIntent; createdAt: string; payment: PrivatePaymentState | null;
  claim: PrivateExecutionClaim | null; saved: PrivateResearchResult | null };

async function job(n = 1, owner = alice, question = "Known private completed question"): Promise<Job> {
  const request: PrivateResearchIntent["submission"]["request"] = { question, budget: 0.03, researchMode: "quick",
    packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
  const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
  const requirement: PrivateResearchIntent["requirement"] = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC,
    amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
  const salt = `0x${n.toString(16).padStart(64, "0")}`;
  const terms = { from: owner, to: merchants.privatePayee, value: "50000", validAfter: "1788911400", validBefore: "1789516860" };
  const nonce = await privateRequestNonce(request, requirement, terms, salt);
  const id = `prv_${createHash("sha256").update(["keryx-private-order-v1", BUYER_NETWORK, owner, terms.to, nonce].join("|")).digest("hex")}`;
  // Structural signature bytes emulate the already-validated adapter output. Never sign or
  // mock a verifier to accept them. Real SQLite/PostgreSQL signature admission is a parent gate.
  const intent: PrivateResearchIntent = { id, submission: { request, salt,
    payment: { authorization: { ...terms, nonce }, signature: `0x${"ef".repeat(65)}` } }, requirement, merchants };
  const payment = privatePaymentState({ started_at: time, settled_at: time,
    confirmation: { source: "circle-facilitator-success", transaction: `synthetic-incoming-${n}`,
      network: BUYER_NETWORK, payer: owner, payee: terms.to, amountMicros: terms.value, authorizationId: nonce } }, intent);
  const claim = { id, workerId: "11111111-1111-4111-8111-111111111111", startedAt: time };
  const run = { id, question, budget: request.budget, researchMode: request.researchMode, asker: owner,
    paymentMode: "real", fundingOwner: "treasury", origin: "a2a", engine: "synthetic-owner-result",
    answer: "Known immutable owner answer", createdAt: time, subClaims: ["Known claim"],
    decisions: [{ sourceId: "source-one", sourceName: "Synthetic source", action: "BUY", rationale: "Known reason",
      price: 0.01, expectedValue: 0.5, confidence: 0.5, targets: [0], receipt: { ciphertext: hidden } }],
    citations: [{ marker: "[1]", sourceId: "source-one", sourceName: "Synthetic source", weight: 1, reward: 0.01,
      rationale: "Known attribution", transport: hidden }],
    trace: [{ data: hidden }], ciphertext: hidden, workerSecret: hidden, internalMetadata: hidden,
    totalSpent: 9999, totalToCreators: 9999, originalFulfillment: { private: hidden } };
  return { intent, createdAt: time, payment, claim, saved: { id, format: "query-run-v1", serializedRun: JSON.stringify(run), savedAt: time } };
}
function storage(jobs: Job[]) {
  const find = (id: string, payer: string) => jobs.find(row => row.intent.id === id && row.intent.submission.payment.authorization.from === payer);
  const db = {
    listPrivateResearchHistory: vi.fn(async (payer: string, before?: PrivateJobPosition) => jobs
      .filter(row => row.intent.submission.payment.authorization.from === payer)
      .sort((a, b) => -comparePrivateJobPosition({ id: a.intent.id, createdAt: a.createdAt }, { id: b.intent.id, createdAt: b.createdAt }))
      .filter(row => !before || comparePrivateJobPosition({ id: row.intent.id, createdAt: row.createdAt }, before) < 0)
      .slice(0, 26).map(row => clone({ intent: row.intent, createdAt: row.createdAt }))),
    getPrivateResearchIntent: vi.fn(async (id: string, payer: string) => clone(find(id, payer)?.intent ?? null)),
    getPrivatePaymentState: vi.fn(async (id: string, payer: string) => clone(find(id, payer)?.payment ?? null)),
    getPrivateResearchExecution: vi.fn(async (id: string, payer: string) => clone(find(id, payer)?.claim ?? null)),
    getPrivateResearchResult: vi.fn(async (id: string, payer: string) => clone(find(id, payer)?.saved ?? null)),
  } satisfies PrivateJobHistoryDB;
  return db;
}
function request(body: unknown = {}, headers: Record<string, string> = {}, signal?: AbortSignal, query = "") {
  return new Request(`https://synthetic.example/private-history${query}`, { method: "POST",
    headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
}
function routeFixture(db: PrivateJobHistoryDB) {
  const session = vi.fn(async (): Promise<{ db: PrivateJobHistoryDB; wallet: string; currentId: string } | Response> => ({ db, wallet: alice, currentId }));
  const key = vi.fn(async (_raw: string): Promise<{ walletAddress: string; scopes: string | null } | null> => ({ walletAddress: alice, scopes: "history:read" }));
  const getDb = vi.fn(async () => db);
  const deps = { session, key, db: getDb };
  return { session, key, getDb, list: createPrivateJobHistoryRoute(deps),
    detail: createPrivateJobHistoryRoute(deps, "detail"), export: createPrivateJobHistoryRoute(deps, "export") };
}
async function refusal(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Keryx-Expected-Wallet");
  const wire = await response.text();
  for (const secret of [hidden, "Known private completed", "Known immutable", alice, "serializedRun", "workerId", "rows"])
    expect(wire).not.toContain(secret);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}
afterEach(() => vi.useRealTimers());

describe("completed private job storage projection (unrun)", () => {
  it("returns the known finalized owner record, unknown historical provenance and separately labelled incoming evidence", async () => {
    const own = await job(), foreign = await job(2, bob), db = storage([own, foreign]);
    const page = privateJobHistoryPageSchema.parse(await readPrivateJobHistory(db, alice));
    expect(page.rows.map(row => row.id)).toEqual([own.intent.id]);
    expect(page.rows[0]).toMatchObject({ record: "finalized-private-result", provenance: null, ownSettledSpendMicros: null,
      creatorRewardsMicros: null, paidCreators: null, incomingSettlement: { amountMicros: "50000", chainFinalityVerified: false } });
    expect(page.capabilities.multiwallet).toBe(false);
    const detail = await readPrivateJobHistoryDetail(db, alice, own.intent.id);
    expect(detail?.result.answer).toBe("Known immutable owner answer");
    expect(detail?.result.citations[0].recordedRewardUsdc).toBe(0.01);
    expect(detail?.result.evidence).toBeNull(); expect(detail?.result.claimCoverage).toBeNull();
    expect(detail?.row.intentCreatedAt).toBeNull(); expect(page.rows[0].intentCreatedAt).toBe(time);
    const wire = JSON.stringify({ page, detail });
    for (const secret of [hidden, foreign.intent.id, own.intent.submission.salt, own.intent.submission.payment.signature,
      own.intent.submission.payment.authorization.nonce, own.claim!.workerId, "trace", "serializedRun", "9999", "/api/me/asks", "authorization"])
      expect(wire).not.toContain(secret);
    expect(await readPrivateJobHistoryDetail(db, bob, own.intent.id)).toBeNull();
    expect((await readPrivateJobHistory(db, bob)).rows.map(row => row.id)).toEqual([foreign.intent.id]);
    expect(own.saved!.serializedRun).toContain(hidden); // Original storage was not rewritten.
  });
  it("does not count intent-only, pending payment or execution-claimed jobs as completed", async () => {
    const jobs = await Promise.all([job(1), job(2), job(3)]);
    jobs[0].payment = null; jobs[0].claim = null; jobs[0].saved = null;
    jobs[1].payment = { id: jobs[1].intent.id, startedAt: time, status: "pending", confirmation: null, settledAt: null };
    jobs[1].claim = null; jobs[1].saved = null; jobs[2].saved = null;
    const db = storage(jobs), value = await readPrivateJobHistory(db, alice);
    expect(value.rows).toEqual([]); expect(value.scannedIntents).toBe(3); expect(value.nextCursor).toBeNull();
    for (const value of jobs) expect(await readPrivateJobHistoryDetail(db, alice, value.intent.id)).toBeNull();
  });
  it.each(["run-id", "question", "payer", "claim-id", "orphan", "pending-result", "payment-id", "payment-payer", "claim-index", "malformed-json"])(
    "refuses %s before releasing any row", async change => {
      const value = await job(), good = await job(2), db = storage([good, value]);
      const run = JSON.parse(value.saved!.serializedRun);
      if (change === "run-id") run.id = good.intent.id;
      if (change === "question") run.question = "Substituted question";
      if (change === "payer") run.asker = bob;
      if (change === "claim-index") run.decisions[0].targets = [1];
      if (change === "claim-id") value.claim!.id = good.intent.id;
      if (change === "orphan") value.claim = null;
      if (change === "pending-result") value.payment = { id: value.intent.id, startedAt: time, status: "pending", confirmation: null, settledAt: null };
      if (change === "payment-id") value.payment!.id = good.intent.id;
      if (change === "payment-payer" && value.payment?.status === "settled") value.payment.confirmation.payer = bob;
      value.saved!.serializedRun = change === "malformed-json" ? "{broken" : JSON.stringify(run);
      await expect(readPrivateJobHistory(db, alice)).rejects.toThrow("history_unavailable");
      await refusal(await routeFixture(db).list(request()), 503);
    });
  it("rejects a foreign list row and signed-request substitution even through a supplied backend port", async () => {
    const own = await job(), foreign = await job(2, bob), db = storage([own]);
    db.listPrivateResearchHistory.mockResolvedValueOnce([{ intent: foreign.intent, createdAt: time }]);
    await expect(readPrivateJobHistory(db, alice)).rejects.toThrow("history_unavailable");
    own.intent.submission.request.question = "Changed after immutable commitment";
    await refusal(await routeFixture(db).list(request()), 503);
  });
  it.each(["worker", "result", "intent", "erase"])("fences %s changes after result IO", async change => {
    const value = await job(), db = storage([value]), original = clone(value.saved!);
    db.getPrivateResearchResult.mockImplementationOnce(async () => {
      if (change === "worker") value.claim!.workerId = "22222222-2222-4222-8222-222222222222";
      if (change === "result") value.saved!.serializedRun = value.saved!.serializedRun.replace("Known immutable", "Changed immutable");
      if (change === "intent") value.intent.submission.payment.signature = `0x${"dd".repeat(65)}`;
      if (change === "erase") value.saved = null;
      return original;
    });
    await refusal(await routeFixture(db).detail(request({ id: value.intent.id })), 503);
  });
  it("refuses absent/accessor/undefined ports and accessor/cyclic/oversized data without evaluating getters", async () => {
    const value = await job(), db = storage([value]);
    for (const name of ["listPrivateResearchHistory", "getPrivateResearchResult"] as const) {
      const missing = { ...db, [name]: undefined } as unknown as PrivateJobHistoryDB;
      await expect(readPrivateJobHistory(missing, alice)).rejects.toThrow("history_unavailable");
    }
    const getter = vi.fn(() => db.listPrivateResearchHistory), accessor = { ...db };
    Object.defineProperty(accessor, "listPrivateResearchHistory", { get: getter });
    await expect(readPrivateJobHistory(accessor, alice)).rejects.toThrow("history_unavailable"); expect(getter).not.toHaveBeenCalled();
    db.getPrivateResearchResult.mockResolvedValueOnce(undefined as unknown as PrivateResearchResult);
    await expect(readPrivateJobHistoryDetail(db, alice, value.intent.id)).rejects.toThrow("history_unavailable");
    const unsafe = clone(value.saved!), readGetter = vi.fn(() => "secret");
    Object.defineProperty(unsafe, "serializedRun", { get: readGetter });
    db.getPrivateResearchResult.mockResolvedValueOnce(unsafe);
    await expect(readPrivateJobHistoryDetail(db, alice, value.intent.id)).rejects.toThrow("history_unavailable"); expect(readGetter).not.toHaveBeenCalled();
    const cyclic = { intent: value.intent, createdAt: time } as Record<string, unknown>; cyclic.loop = cyclic;
    db.listPrivateResearchHistory.mockResolvedValueOnce([cyclic] as never);
    await expect(readPrivateJobHistory(db, alice)).rejects.toThrow("history_unavailable");
    value.saved!.serializedRun = "x".repeat(B.recordBytes + 1);
    await expect(readPrivateJobHistoryDetail(db, alice, value.intent.id)).rejects.toThrow("history_unavailable");
  });
  it("uses only the five read ports, ignoring global membership, public reports, producers and financial services", async () => {
    const value = await job(), db = storage([value]);
    const forbidden = vi.fn(() => { throw new Error("Forbidden side effect"); });
    const extended = { ...db, historyMembership: { resolve: forbidden }, getQueryRun: forbidden, saveQueryRun: forbidden,
      savePrivateResearchResult: forbidden, claimPrivateResearchExecution: forbidden, claimPrivatePayment: forbidden,
      listPrivateCreatorSubmissions: forbidden, provider: forbidden, search: forbidden, pay: forbidden, signer: forbidden };
    await readPrivateJobHistory(extended, alice); await readPrivateJobHistoryDetail(extended, alice, value.intent.id);
    await exportPrivateJobHistory(extended, alice); expect(forbidden).not.toHaveBeenCalled();
    for (const name of ["getPrivateResearchIntent", "getPrivatePaymentState", "getPrivateResearchExecution", "getPrivateResearchResult"] as const)
      expect(db[name].mock.calls.every(call => call[1] === alice)).toBe(true);
  });
});

describe("bounded stable private paging and export (unrun)", () => {
  it("preserves exact microsecond cursors, tied IDs and the upper anchor across newer insertion", async () => {
    const jobs = await Promise.all(Array.from({ length: 28 }, (_, i) => job(i + 1))), db = storage(jobs);
    const first = await readPrivateJobHistory(db, alice, { limit: 10 });
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString());
    expect(decoded.upper.createdAt).toBe(time); expect(decoded.before.createdAt).toBe(time);
    const inserted = await job(40); inserted.createdAt = "2026-10-14T00:00:00.123457+00:00"; jobs.push(inserted);
    const rows = [...first.rows]; let cursor = first.nextCursor;
    while (cursor) { const page = await readPrivateJobHistory(db, alice, { limit: 10, cursor }); rows.push(...page.rows); cursor = page.nextCursor; }
    expect(rows).toHaveLength(28); expect(new Set(rows.map(row => row.id)).size).toBe(28);
    expect(rows.some(row => row.id === inserted.intent.id)).toBe(false);
    expect(rows.map(row => row.id)).toEqual(jobs.filter(row => row !== inserted).map(row => row.intent.id).sort().reverse());
  });
  it.each(["duplicate", "out-of-order", "above-upper", "at-before", "overflow"])("rejects %s DB cursor responses", async change => {
    const jobs = await Promise.all([job(1), job(2), job(3)]), db = storage(jobs);
    const first = await readPrivateJobHistory(db, alice, { limit: 1 });
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString());
    const rows = jobs.map(row => ({ intent: row.intent, createdAt: row.createdAt })).sort((a, b) => b.intent.id.localeCompare(a.intent.id));
    let reply = rows.slice(1);
    if (change === "duplicate") reply = [reply[0], reply[0]];
    if (change === "out-of-order") reply = reply.reverse();
    if (change === "above-upper") reply = [{ ...rows[0], createdAt: "2026-10-15T00:00:00.000Z" }];
    if (change === "at-before") reply = [{ intent: jobs.find(row => row.intent.id === cursor.before.id)!.intent, createdAt: cursor.before.createdAt }];
    if (change === "overflow") reply = Array(27).fill(reply[0]);
    db.listPrivateResearchHistory.mockResolvedValueOnce(reply);
    await expect(readPrivateJobHistory(db, alice, { limit: 1, cursor: first.nextCursor! })).rejects.toThrow("history_unavailable");
  });
  it("rejects owner/query/limit substitution and inverted cursor bounds before DB IO", async () => {
    const jobs = await Promise.all([job(1), job(2)]), db = storage(jobs);
    const first = await readPrivateJobHistory(db, alice, { limit: 1, search: "Known" });
    const count = db.listPrivateResearchHistory.mock.calls.length;
    for (const [owner, input] of [[bob, { limit: 1, search: "Known" }], [alice, { limit: 1, search: "Changed" }], [alice, { limit: 2, search: "Known" }]] as const)
      await expect(readPrivateJobHistory(db, owner, { ...input, cursor: first.nextCursor! })).rejects.toThrow("invalid_history_query");
    const decoded = JSON.parse(Buffer.from(first.nextCursor!, "base64url").toString());
    decoded.before.createdAt = "2026-10-15T00:00:00.000Z";
    await expect(readPrivateJobHistory(db, alice, { limit: 1, search: "Known", cursor: Buffer.from(JSON.stringify(decoded)).toString("base64url") })).rejects.toThrow("invalid_history_query");
    expect(db.listPrivateResearchHistory).toHaveBeenCalledTimes(count);
  });
  it("supports literal question/date/network/provenance filtering, with empty continuing scans", async () => {
    const jobs = await Promise.all(Array.from({ length: 27 }, (_, i) => job(i + 1, alice, i === 0 ? "Exact %_ Needle" : "Other"))), db = storage(jobs);
    for (const value of jobs) value.saved = null; // More than one bounded intent-only page.
    const first = await readPrivateJobHistory(db, alice, { search: "Needle" });
    expect(first.rows).toEqual([]); expect(first.scanLimited).toBe(true); expect(first.scannedIntents).toBe(25);
    const second = await readPrivateJobHistory(db, alice, { search: "Needle", cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull(); expect(second.scannedIntents).toBe(2);
    const value = await job(40, alice, "Exact %_ Needle"), known = storage([value]);
    expect((await readPrivateJobHistory(known, alice, { search: "%_", surface: "unknown", network: BUYER_NETWORK, from: time, to: time })).rows).toHaveLength(1);
    expect((await readPrivateJobHistory(known, alice, { search: "needle" })).rows).toEqual([]);
    expect((await readPrivateJobHistory(known, alice, { surface: "agent-to-agent" })).rows).toEqual([]); // origin is not provenance.
    const run = JSON.parse(value.saved!.serializedRun); run.provenance = { version: 1, surface: "api", ownershipMethod: "api-key" };
    value.saved!.serializedRun = JSON.stringify(run);
    expect((await readPrivateJobHistory(known, alice, { surface: "api" })).rows).toHaveLength(1);
    await expect(readPrivateJobHistory(known, alice, { funding: "paid" } as never)).rejects.toThrow("invalid_history_query");
  });
  it("exports real projected rows and CSV with continuation metadata and formula protection", async () => {
    const jobs = await Promise.all([job(1, alice, "=SUM(1,2)"), job(2), job(3)]), db = storage(jobs);
    const original = jobs.map(value => value.saved!.serializedRun);
    const value = await exportPrivateJobHistory(db, alice, { limit: 1 });
    expect(value.rows).toHaveLength(3); expect(value.complete).toBe(true); expect(value.truncated).toBe(false); expect(value.pages).toBe(3);
    const csv = privateJobHistoryCsv(value);
    expect(csv).toContain("'=SUM(1,2)"); expect(csv).toContain("metadata"); expect(csv).toContain("Known private completed question");
    expect(csv).not.toContain(hidden); expect(value.rows.find(row => row.id === jobs[0].intent.id)!.question).toBe("=SUM(1,2)");
    expect(jobs.map(value => value.saved!.serializedRun)).toEqual(original);
  });
  it("reports bounded export truncation and rechecks early rows after later pages", async () => {
    const jobs = await Promise.all(Array.from({ length: 21 }, (_, i) => job(i + 1))), db = storage(jobs);
    const bounded = await exportPrivateJobHistory(db, alice, { limit: 1 });
    expect(bounded.rows).toHaveLength(20); expect(bounded.pages).toBe(20); expect(bounded.complete).toBe(false); expect(bounded.nextCursor).not.toBeNull();
    const rest = await exportPrivateJobHistory(db, alice, { limit: 1, cursor: bounded.nextCursor! });
    expect(rest.rows).toHaveLength(1); expect(rest.complete).toBe(true);
    let calls = 0;
    db.listPrivateResearchHistory.mockImplementation(async (payer, before) => {
      const rows = jobs.filter(row => row.intent.submission.payment.authorization.from === payer)
        .sort((a, b) => b.intent.id.localeCompare(a.intent.id));
      if (++calls === 2) rows[0].saved = null;
      return rows.filter(row => !before || row.intent.id < before.id).slice(0, 26).map(row => clone({ intent: row.intent, createdAt: time }));
    });
    await expect(exportPrivateJobHistory(db, alice, { limit: 1 })).rejects.toThrow("history_unavailable");
  });
  it("returns a resumable byte-limited export without skipping the omitted page", async () => {
    // Fits the original 2,000-character request bound; JSON escaping tests actual wire bytes.
    const question = `q${"\u0001".repeat(1998)}q`;
    const jobs = await Promise.all(Array.from({ length: 260 }, (_, i) => job(i + 1, alice, question))), db = storage(jobs);
    const first = await exportPrivateJobHistory(db, alice);
    expect(first.truncated).toBe(true); expect(first.complete).toBe(false); expect(first.nextCursor).not.toBeNull();
    expect(first.rows.length).toBeGreaterThan(0); expect(first.rows.length).toBeLessThan(260);
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(B.exportBytes);
    const rest = await exportPrivateJobHistory(db, alice, { cursor: first.nextCursor! });
    expect(rest.complete).toBe(true);
    const all = [...first.rows, ...rest.rows]; expect(all).toHaveLength(260); expect(new Set(all.map(row => row.id)).size).toBe(260);
  });
});

describe("private HTTP and stale async release fences (unrun)", () => {
  it("serves a known report/list/export only through independently verified exact owner callbacks", async () => {
    const value = await job(), db = storage([value]), f = routeFixture(db);
    const list = await f.list(request({}, { "x-keryx-expected-wallet": alice }));
    expect(list.status).toBe(200); expect((await list.json()).rows[0].id).toBe(value.intent.id);
    expect(f.session).toHaveBeenCalledTimes(2);
    const detail = await f.detail(request({ id: value.intent.id }, { authorization: `Bearer ${rawKey}` }));
    expect(detail.status).toBe(200); expect(privateJobHistoryDetailSchema.parse(await detail.json()).result.answer).toBe("Known immutable owner answer");
    expect(f.key.mock.calls).toEqual([[rawKey], [rawKey]]);
    const csv = await f.export(request({ format: "csv" })); expect(csv.status).toBe(200); expect(await csv.text()).toContain("Known private completed question");
    f.session.mockResolvedValue({ db, wallet: bob, currentId });
    await refusal(await f.detail(request({ id: value.intent.id })), 404);
  });
  it("denies no identity, malformed bearer, old scopes, invalid expected wallet and foreign owner preconditions before IO", async () => {
    const value = await job(), db = storage([value]), f = routeFixture(db);
    f.session.mockResolvedValue(Response.json({ error: "unauthenticated" }, { status: 401 }));
    await refusal(await f.list(request()), 401);
    await refusal(await f.list(request({}, { authorization: "Bearer bad" })), 401);
    f.key.mockResolvedValue({ walletAddress: alice, scopes: "ask,export" });
    await refusal(await f.list(request({}, { authorization: `Bearer ${rawKey}` })), 403);
    await refusal(await f.list(request({}, { "x-keryx-expected-wallet": "bad" })), 400);
    f.key.mockResolvedValue({ walletAddress: alice, scopes: "history:read" });
    await refusal(await f.list(request({}, { authorization: `Bearer ${rawKey}`, "x-keryx-expected-wallet": bob })), 409);
    expect(db.listPrivateResearchHistory).not.toHaveBeenCalled();
  });
  it.each(["revoked-key", "key-scope", "key-wallet", "session-revoked", "session-replaced", "session-wallet", "session-id"])(
    "suppresses private IO output for %s without cookie fallback", async change => {
      const value = await job(), db = storage([value]), f = routeFixture(db);
      const entered = deferred<void>(), release = deferred<PrivateResearchResult | null>();
      db.getPrivateResearchResult.mockImplementationOnce(async () => { entered.resolve(); return release.promise; });
      const keyed = change.startsWith("key") || change === "revoked-key";
      const pending = f.detail(request({ id: value.intent.id }, keyed ? { authorization: `Bearer ${rawKey}` } : {}));
      await entered.promise;
      if (change === "revoked-key") f.key.mockResolvedValue(null);
      if (change === "key-scope") f.key.mockResolvedValue({ walletAddress: alice, scopes: "ask" });
      if (change === "key-wallet") f.key.mockResolvedValue({ walletAddress: bob, scopes: "history:read" });
      if (change === "session-revoked") f.session.mockResolvedValue(Response.json({ error: "unauthenticated" }, { status: 401 }));
      if (change === "session-replaced") f.session.mockResolvedValue({ db, wallet: alice, currentId: replacementId });
      if (change === "session-wallet") f.session.mockResolvedValue({ db, wallet: bob, currentId });
      if (change === "session-id") f.session.mockResolvedValue({ db, wallet: alice, currentId: "" });
      release.resolve(clone(value.saved));
      await refusal(await pending, change.includes("revoked") ? 401 : change === "key-scope" ? 403 : 409);
      if (keyed) expect(f.session).not.toHaveBeenCalled();
    });
  it.each(["list", "detail", "export"] as const)("discards aborted pending %s and any later private result", async action => {
    const value = await job(), db = storage([value]), f = routeFixture(db), controller = new AbortController();
    const entered = deferred<void>(), release = deferred<PrivateResearchResult | null>();
    db.getPrivateResearchResult.mockImplementationOnce(async () => { entered.resolve(); return release.promise; });
    const pending = f[action](request(action === "detail" ? { id: value.intent.id } : {}, {}, controller.signal));
    await entered.promise; controller.abort(); await refusal(await pending, 503);
    release.resolve(clone(value.saved)); await Promise.resolve();
  });
  it("enforces deadlines for a never-resolving read and for delayed post-read key validation", async () => {
    const value = await job(), db = storage([value]);
    vi.useFakeTimers();
    const entered = deferred<void>();
    db.getPrivateResearchResult.mockImplementationOnce(async () => { entered.resolve(); return new Promise(() => undefined); });
    const pending = routeFixture(db).detail(request({ id: value.intent.id }));
    await entered.promise; await vi.advanceTimersByTimeAsync(B.readMs + 1); await refusal(await pending, 503);
    const f = routeFixture(storage([value])), keyEntered = deferred<void>();
    f.key.mockImplementationOnce(async () => ({ walletAddress: alice, scopes: "history:read" }))
      .mockImplementationOnce(async () => { keyEntered.resolve(); return new Promise(() => undefined); });
    const response = f.list(request({}, { authorization: `Bearer ${rawKey}` }));
    await keyEntered.promise; await vi.advanceTimersByTimeAsync(B.readMs + 1); await refusal(await response, 503);
  });
  it("refuses query selectors, unsupported modes, chunked overflow, malformed UTF-8 and count overflow", async () => {
    const value = await job(), db = storage([value]), f = routeFixture(db);
    await refusal(await f.list(request({}, {}, undefined, "?cursor=private")), 400);
    for (const input of [{ wholeHistory: true }, { wallets: [bob] }, { visibility: "public" }, { format: "receipts" }, { limit: 26 }])
      await refusal(await f.list(request(input)), 400);
    const streaming = new Request("https://synthetic.example/private-history", { method: "POST", body: new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(B.requestBytes + 1))); controller.close(); },
    }), duplex: "half" } as RequestInit);
    await refusal(await f.list(streaming), 400);
    await refusal(await f.list(new Request("https://synthetic.example/private-history", { method: "POST", body: new Uint8Array([0xff]) })), 400);
    const run = JSON.parse(value.saved!.serializedRun); run.subClaims = Array(129).fill("too many"); value.saved!.serializedRun = JSON.stringify(run);
    await refusal(await f.detail(request({ id: value.intent.id })), 503);
  });
  it("refuses corrupt storage even when an earlier valid row or export page exists", async () => {
    const values = await Promise.all([job(1), job(2)]), db = storage(values);
    values.sort((a, b) => b.intent.id.localeCompare(a.intent.id)); values[1].saved!.serializedRun = "{}";
    await refusal(await routeFixture(db).list(request()), 503);
    await refusal(await routeFixture(db).export(request({ limit: 1 })), 503);
  });
  it("refuses the total UTF-8 detail byte cap and an already-expired read before IO", async () => {
    const value = await job(), db = storage([value]), run = JSON.parse(value.saved!.serializedRun);
    run.answer = "a".repeat(512 * 1024);
    run.evidence = Array.from({ length: 40 }, (_, i) => ({ claimIndex: 0, claim: "Known claim", marker: `[${i}]`,
      sourceId: "source-one", sourceName: "Synthetic source", quote: "q".repeat(32768), support: 1, qualifiesForReward: false }));
    value.saved!.serializedRun = JSON.stringify(run);
    await refusal(await routeFixture(db).detail(request({ id: value.intent.id })), 503);
    const fresh = storage([await job(2)]);
    await expect(readPrivateJobHistory(fresh, alice, {}, { deadline: Date.now() - 1 })).rejects.toThrow("history_unavailable");
    expect(fresh.listPrivateResearchHistory).not.toHaveBeenCalled();
  });
});
