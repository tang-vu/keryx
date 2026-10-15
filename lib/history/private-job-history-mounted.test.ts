// UNRUN. Exercise the real mounted exports/factory/reader with established auth/read-port
// substitutions only. Synthetic signatures are not real adapter/payment acceptance.
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrivateResearchIntent } from "../a2a/private-research-intent";
import type { PrivateResearchResult } from "../db/private-research-results";
import type { PrivateExecutionClaim } from "../db/private-research-executions";
import type { PrivatePaymentState } from "../a2a/private-payment-state";
import { privatePaymentState } from "../a2a/private-payment-state";
import { privateRequestNonce } from "../buyer/private-request-commitment";
import { BUYER_NETWORK, BUYER_USDC, BUYER_GATEWAY } from "../buyer/protocol";
import type { PrivateJobHistoryDB } from "./private-job-history";
import { comparePrivateJobPosition, privateJobHistoryPageSchema, privateJobHistoryDetailSchema,
  type PrivateJobPosition } from "./private-job-history-contract";

const boundary = vi.hoisted(() => ({ session: vi.fn(), key: vi.fn(), db: vi.fn(),
  config: { baseUrl: "https://mounted.example/server-config-path" } }));
vi.mock("@/lib/account-sessions", () => ({ accountSessionContext: boundary.session }));
vi.mock("@/lib/api-keys", () => ({ verifyApiKey: boundary.key }));
vi.mock("@/lib/db", () => ({ getDb: boundary.db }));
vi.mock("@/lib/config", () => ({ config: boundary.config }));
import * as list from "@/app/api/me/private-jobs/route";
import * as detail from "@/app/api/me/private-jobs/detail/route";
import * as exporter from "@/app/api/me/private-jobs/export/route";

const origin = "https://mounted.example", alice = `0x${"11".repeat(20)}`, bob = `0x${"22".repeat(20)}`;
const currentId = "a".repeat(64), rawKey = `kx_live_${"3".repeat(96)}`;
const hidden = "SYNTHETIC_MOUNT_INTERNAL_DO_NOT_DELIVER", answer = "Known mounted private answer";
const paths = [
  { path: "/api/me/private-jobs", routes: list, body: {} },
  { path: "/api/me/private-jobs/detail", routes: detail, body: { id: `prv_${"a".repeat(64)}` } },
  { path: "/api/me/private-jobs/export", routes: exporter, body: {} },
];
type Job = { intent: PrivateResearchIntent; createdAt: string; payment: PrivatePaymentState | null;
  claim: PrivateExecutionClaim | null; saved: PrivateResearchResult | null };
const clone = <T>(value: T): T => structuredClone(value);
async function job(n = 1, owner = alice, question = "=Known mounted private question"): Promise<Job> {
  const createdAt = `2026-10-14T00:00:00.${String(n).padStart(6, "0")}+00:00`;
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
  // Emulate already-admitted read-port output; no signer or mocked verifier is used.
  const intent: PrivateResearchIntent = { id, requirement, merchants, submission: { request, salt,
    payment: { authorization: { ...terms, nonce }, signature: `0x${"ef".repeat(65)}` } } };
  const payment = privatePaymentState({ started_at: createdAt, settled_at: createdAt,
    confirmation: { source: "circle-facilitator-success", transaction: `synthetic-mounted-incoming-${n}`,
      network: BUYER_NETWORK, payer: owner, payee: terms.to, amountMicros: terms.value, authorizationId: nonce } }, intent);
  const claim = { id, workerId: "11111111-1111-4111-8111-111111111111", startedAt: createdAt };
  const run = { id, question, budget: request.budget, researchMode: request.researchMode, asker: owner,
    paymentMode: "real", fundingOwner: "treasury", origin: "a2a", engine: "synthetic-mounted-result", answer, createdAt,
    subClaims: ["Known claim"], decisions: [], citations: [{ marker: "[1]", sourceId: "source-one",
      sourceName: "Synthetic source", weight: 1, reward: 0.01, rationale: "Known attribution", transport: hidden }],
    trace: [{ data: hidden }], ciphertext: hidden, workerSecret: hidden, totalSpent: 9999, totalToCreators: 9999 };
  return { intent, createdAt, payment, claim, saved: { id, format: "query-run-v1", serializedRun: JSON.stringify(run), savedAt: createdAt } };
}
function storage(jobs: Job[]) {
  const find = (id: string, payer: string) => jobs.find(row => row.intent.id === id && row.intent.submission.payment.authorization.from === payer);
  return {
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
}
let db: ReturnType<typeof storage>;
beforeEach(() => {
  vi.resetAllMocks(); db = storage([]);
  boundary.session.mockImplementation(async () => ({ db, wallet: alice, currentId }));
  boundary.key.mockResolvedValue({ walletAddress: alice, scopes: "history:read" });
  boundary.db.mockImplementation(async () => db);
});
function request(path = paths[0].path, body: unknown = {}, headers: Record<string, string> = { origin },
  signal?: AbortSignal, method = "POST") {
  return new Request(`${origin}${path}`, { method, headers: { "content-type": "application/json", ...headers },
    ...(method === "GET" || method === "HEAD" ? {} : { body: JSON.stringify(body) }), signal });
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  expect(response.headers.get("vary")).toBe("Cookie, Authorization, X-Keryx-Expected-Wallet");
}
async function refusal(response: Response, status: number) {
  expect(response.status).toBe(status); privateHeaders(response);
  const wire = await response.text();
  for (const secret of [hidden, answer, "Known mounted private question", alice, bob, rawKey, "serializedRun", "workerId", '"rows"'])
    expect(wire).not.toContain(secret);
}
function noData() { for (const port of Object.values(db)) expect(port).not.toHaveBeenCalled(); }
function noAuthOrData() {
  expect(boundary.session).not.toHaveBeenCalled(); expect(boundary.key).not.toHaveBeenCalled();
  expect(boundary.db).not.toHaveBeenCalled(); noData();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}

describe("actual completed-private-job mounted exports (UNRUN)", () => {
  it.each([
    { label: "malformed", baseUrl: "not a URL" },
    { label: "non-HTTP(S)", baseUrl: "ftp://mounted.example/server-config-path" },
    { label: "opaque non-HTTP(S)", baseUrl: "data:text/plain,synthetic-config" },
  ])("refuses $label trusted baseUrl before auth/storage on all mounts", async ({ baseUrl }) => {
    const validBaseUrl = boundary.config.baseUrl;
    boundary.config.baseUrl = baseUrl;
    // Each mount captures trusted config at construction; changing the mock alone is insufficient.
    vi.resetModules();
    try {
      const mounts = [
        await import("@/app/api/me/private-jobs/route"),
        await import("@/app/api/me/private-jobs/detail/route"),
        await import("@/app/api/me/private-jobs/export/route"),
      ];
      const credentials: Record<string, string>[] = [
        { origin }, { authorization: `Bearer ${rawKey}` },
        { origin, authorization: `Bearer ${rawKey}` },
      ];
      for (const [index, { path, body }] of paths.entries()) {
        for (const headers of credentials) {
          const response = await mounts[index]!.POST(request(path, body, headers));
          expect(await response.clone().json()).toEqual({ error: "history_unavailable" });
          await refusal(response, 503); noAuthOrData();
        }
      }
    } finally {
      boundary.config.baseUrl = validBaseUrl;
      vi.resetModules();
    }
  });
  it.each(paths)("rejects absent/foreign browser Origin before auth/storage at $path", async ({ path, routes, body }) => {
    const cases: Record<string, string>[] = [{}, { origin: "https://foreign.example", host: "foreign.example" },
      { origin: "http://mounted.example" }, { origin: "https://mounted.example/" }, { origin: "null" }];
    for (const headers of cases) {
      await refusal(await routes.POST(request(path, body, headers)), 403); noAuthOrData();
    }
  });
  it.each(paths)("rejects any present foreign Origin for a bearer at $path", async ({ path, routes, body }) => {
    await refusal(await routes.POST(request(path, body, { origin: "https://foreign.example", authorization: `Bearer ${rawKey}` })), 403);
    noAuthOrData();
  });
  it.each(paths)("keeps method and URL selectors private and refuses before data at $path", async ({ path, routes, body }) => {
    for (const method of ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"] as const) {
      const response = await routes[method](request(path, body, {}, undefined, method));
      expect(response.headers.get("allow")).toBe("POST"); await refusal(response, 405); noAuthOrData();
    }
    for (const query of ["?id=prv_hidden", "?cursor=private", "?contract=owned", "?format=report"]) {
      await refusal(await routes.POST(request(path + query, body)), 400); noAuthOrData();
    }
  });
  it.each([null, "ask,export", "profile:read", "unknown"])("requires explicit history:read without cookie fallback (%s)", async scopes => {
    boundary.key.mockResolvedValue({ walletAddress: alice, scopes });
    await refusal(await list.POST(request(undefined, {}, { authorization: `Bearer ${rawKey}` })), 403);
    expect(boundary.key).toHaveBeenCalledExactlyOnceWith(rawKey);
    expect(boundary.session).not.toHaveBeenCalled(); expect(boundary.db).not.toHaveBeenCalled(); noData();
  });
  it.each(["", "Basic ignored", "Bearer kx_live_bad"])("does not fall back for a malformed Authorization (%s)", async authorization => {
    await refusal(await list.POST(request(undefined, {}, { origin, authorization })), 401); noAuthOrData();
  });
  it("refuses invalid keys, denied sessions and failed credential lookups privately", async () => {
    boundary.key.mockResolvedValue(null);
    await refusal(await list.POST(request(undefined, {}, { authorization: `Bearer ${rawKey}` })), 401);
    expect(boundary.session).not.toHaveBeenCalled(); expect(boundary.db).not.toHaveBeenCalled(); noData();
    boundary.key.mockRejectedValue(new Error(hidden));
    await refusal(await list.POST(request(undefined, {}, { authorization: `Bearer ${rawKey}` })), 503);
    boundary.session.mockResolvedValue(Response.json({ error: "unauthenticated" }, { status: 401 }));
    await refusal(await list.POST(request()), 401); noData();
  });
  it.each(["browser", "key"])("checks the expected owner before private reads (%s)", async credential => {
    const headers: Record<string, string> = credential === "key" ? { authorization: `Bearer ${rawKey}` } : { origin };
    await refusal(await list.POST(request(undefined, {}, { ...headers, "x-keryx-expected-wallet": bob })), 409); noData();
    await refusal(await list.POST(request(undefined, {}, { ...headers, "x-keryx-expected-wallet": "invalid" })), 400); noData();
    expect(boundary.session).toHaveBeenCalledTimes(credential === "key" ? 0 : 1);
    expect(boundary.key).toHaveBeenCalledTimes(credential === "key" ? 1 : 0);
  });
  it.each(paths)("refuses unsupported body selectors/formats before data at $path", async ({ path, routes, body }) => {
    for (const extra of [{ wallet: bob }, { funding: "browser-recorded" }, { wholeHistory: true }, { format: "receipts" }]) {
      await refusal(await routes.POST(request(path, { ...body, ...extra })), 400); noData();
    }
    await refusal(await routes.POST(request(path, [])), 400); noData();
  });
  it("returns only the exact known completed owner job on real list/detail/CSV exports", async () => {
    const own = await job(), foreign = await job(2, bob), pending = await job(3), claimed = await job(4);
    pending.payment = { id: pending.intent.id, startedAt: pending.createdAt, status: "pending", confirmation: null, settledAt: null };
    pending.claim = null; pending.saved = null; claimed.saved = null;
    db = storage([own, foreign, pending, claimed]); const original = own.saved!.serializedRun;
    // The configured Origin is authoritative even if an inbound Host claims another value.
    const response = await list.POST(request(undefined, {}, { origin, host: "foreign.example" }));
    expect(response.status).toBe(200); privateHeaders(response);
    const page = privateJobHistoryPageSchema.parse(await response.json());
    expect(page.rows.map(row => row.id)).toEqual([own.intent.id]); expect(page.scannedIntents).toBe(3);
    expect(page.rows[0]).toMatchObject({ ownerWallet: alice, provenance: null, ownSettledSpendMicros: null,
      creatorRewardsMicros: null, paidCreators: null, incomingSettlement: { chainFinalityVerified: false, amountMicros: "50000" } });
    const report = await detail.POST(request(paths[1].path, { id: own.intent.id }));
    expect(report.status).toBe(200); privateHeaders(report);
    const value = privateJobHistoryDetailSchema.parse(await report.json());
    expect(value.result.answer).toBe(answer); expect(value.result.citations[0].recordedRewardUsdc).toBe(0.01);
    const csvResponse = await exporter.POST(request(paths[2].path, { format: "csv" }, { authorization: `Bearer ${rawKey}` }));
    expect(csvResponse.status).toBe(200); privateHeaders(csvResponse);
    expect(csvResponse.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csvResponse.headers.get("x-keryx-history-truncated")).toBe("false");
    const csv = await csvResponse.text(); expect(csv).toContain(own.intent.id); expect(csv).toContain('"\'=Known mounted private question"');
    expect(csv).toContain('"metadata"'); expect(csv).toContain('"finalized-private-result"');
    const wire = JSON.stringify({ page, value, csv });
    for (const secret of [hidden, foreign.intent.id, pending.intent.id, claimed.intent.id,
      own.intent.submission.salt, own.intent.submission.payment.signature, own.intent.submission.payment.authorization.nonce,
      own.claim!.workerId, "serializedRun", "9999", "/dispatch/", "/api/me/asks"])
      expect(wire).not.toContain(secret);
    expect(own.saved!.serializedRun).toBe(original);
    expect(boundary.key.mock.calls).toEqual([[rawKey], [rawKey]]);
    expect(boundary.session).toHaveBeenCalledTimes(4); expect(boundary.db).toHaveBeenCalledTimes(1);
    expect(boundary.db.mock.invocationCallOrder[0]).toBeGreaterThan(boundary.key.mock.invocationCallOrder[0]);
    await refusal(await detail.POST(request(paths[1].path, { id: foreign.intent.id })), 404);
    await refusal(await detail.POST(request(paths[1].path, { id: claimed.intent.id })), 404);
  });
  it("accepts matching-Origin bearer calls and retains cursors only in the private body", async () => {
    const older = await job(1), newer = await job(2); db = storage([older, newer]);
    const headers = { origin, authorization: `Bearer ${rawKey}` };
    const first = privateJobHistoryPageSchema.parse(await (await list.POST(request(undefined, { limit: 1 }, headers))).json());
    expect(first.rows.map(row => row.id)).toEqual([newer.intent.id]); expect(first.nextCursor).not.toBeNull();
    const second = privateJobHistoryPageSchema.parse(await (await list.POST(request(undefined, { limit: 1, cursor: first.nextCursor }, headers))).json());
    expect(second.rows.map(row => row.id)).toEqual([older.intent.id]); expect(second.nextCursor).toBeNull();
    boundary.key.mockResolvedValue({ walletAddress: bob, scopes: "history:read" });
    const calls = db.listPrivateResearchHistory.mock.calls.length;
    await refusal(await list.POST(request(undefined, { limit: 1, cursor: first.nextCursor }, headers)), 400);
    expect(db.listPrivateResearchHistory).toHaveBeenCalledTimes(calls); expect(boundary.session).not.toHaveBeenCalled();
  });
  it.each(["revoked", "scope", "owner"])("suppresses a serialized response after the same key changes (%s)", async change => {
    db = storage([await job()]);
    const current = change === "revoked" ? null : { walletAddress: change === "owner" ? bob : alice,
      scopes: change === "scope" ? "ask,export" : "history:read" };
    boundary.key.mockResolvedValueOnce({ walletAddress: alice, scopes: "history:read" }).mockResolvedValueOnce(current);
    await refusal(await exporter.POST(request(paths[2].path, { format: "csv" }, { authorization: `Bearer ${rawKey}` })),
      change === "revoked" ? 401 : change === "scope" ? 403 : 409);
    expect(db.getPrivateResearchResult).toHaveBeenCalled(); expect(boundary.key.mock.calls).toEqual([[rawKey], [rawKey]]);
    expect(boundary.session).not.toHaveBeenCalled();
    expect(boundary.key.mock.invocationCallOrder[1]).toBeGreaterThan(db.getPrivateResearchResult.mock.invocationCallOrder.at(-1)!);
  });
  it.each(["revoked", "session", "wallet"])("requires the same durable session and wallet after private IO (%s)", async change => {
    const own = await job(); db = storage([own]);
    boundary.session.mockResolvedValueOnce({ db, wallet: alice, currentId }).mockResolvedValueOnce(change === "revoked"
      ? Response.json({ error: "unauthenticated" }, { status: 401 })
      : { db, wallet: change === "wallet" ? bob : alice, currentId: change === "session" ? "b".repeat(64) : currentId });
    await refusal(await detail.POST(request(paths[1].path, { id: own.intent.id })), change === "revoked" ? 401 : 409);
    expect(db.getPrivateResearchResult).toHaveBeenCalledTimes(2); expect(boundary.session).toHaveBeenCalledTimes(2);
    expect(boundary.db).not.toHaveBeenCalled(); expect(boundary.key).not.toHaveBeenCalled();
  });
  it("refuses an invalid session identity, missing private ports and unavailable backend without empty success", async () => {
    boundary.session.mockResolvedValue({ db, wallet: alice, currentId: "invalid" });
    await refusal(await list.POST(request()), 503); noData();
    boundary.session.mockResolvedValue({ db: {}, wallet: alice, currentId });
    await refusal(await list.POST(request()), 503); noData();
    boundary.db.mockResolvedValue({});
    await refusal(await list.POST(request(undefined, {}, { authorization: `Bearer ${rawKey}` })), 503); noData();
    boundary.db.mockRejectedValue(new Error(hidden));
    await refusal(await list.POST(request(undefined, {}, { authorization: `Bearer ${rawKey}` })), 503); noData();
    boundary.session.mockResolvedValue({ db, wallet: alice, currentId });
    db.listPrivateResearchHistory.mockRejectedValue(new Error(hidden));
    await refusal(await list.POST(request()), 503);
  });
  it("suppresses an aborted request and a late private result without releasing owner data", async () => {
    const stopped = new AbortController(); stopped.abort();
    await refusal(await list.POST(request(undefined, {}, { origin }, stopped.signal)), 503); noAuthOrData();
    const own = await job(); db = storage([own]);
    const entered = deferred<void>(), late = deferred<PrivateResearchResult | null>(), controller = new AbortController();
    db.getPrivateResearchResult.mockImplementationOnce(async () => { entered.resolve(); return late.promise; });
    const pending = detail.POST(request(paths[1].path, { id: own.intent.id }, { origin }, controller.signal));
    await entered.promise; controller.abort(); await refusal(await pending, 503);
    late.resolve(clone(own.saved)); expect(boundary.session).toHaveBeenCalledTimes(1); expect(boundary.key).not.toHaveBeenCalled();
  });
});
