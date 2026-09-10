import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { issueWebSession, parseWebSession, webSessionHash } from "../auth-session";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { readPrivateResultRequest } from "../a2a/private-result-request";
import type { QueryRun } from "../types";
import { privateWorkspaceHistorySchema, privateWorkspaceResultSchema } from "../a2a/private-workspace";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), db: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/config", () => ({ config: { jwtSecret: "synthetic-private-result-secret" } }));
import { POST } from "@/app/api/me/private-jobs/result/route";
import { POST as history } from "@/app/api/me/private-jobs/history/route";

const root = mkdtempSync(join(tmpdir(), "keryx-private-result-")), file = join(root, "db.sqlite");
const db = new SqliteAdapter(file); await db.init();
const storage = new AsyncLocalStorage<string | undefined>();
const secret = "synthetic-private-result-secret";
// Unfunded ephemeral account signs only synthetic local fixtures, never network payments.
const account = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const request = { question: "Synthetic owner-only answer request", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
const authorization = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
const signature = await account.signTypedData(buyerTypedData(authorization.authorization));
const intent = await preparePrivateResearchIntent({ request: authorization.request, salt: authorization.salt,
  payment: { authorization: authorization.authorization, signature } }, requirement, merchants);
await db.reservePrivateResearchIntent(intent);
mocks.cookies.mockImplementation(async () => ({ get: () => storage.getStore() ? { value: storage.getStore() } : undefined }));
mocks.db.mockResolvedValue(db);
afterEach(() => vi.restoreAllMocks());
afterAll(() => { db.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true }); rmdirSync(root); });
function read(token?: string, body: unknown = { id: intent.id }, origin = "https://keryx.cc") {
  return storage.run(token, () => POST(new Request("https://keryx.cc/api/me/private-jobs/result", {
    method: "POST", headers: { host: "keryx.cc", origin, "content-type": "application/json" }, body: JSON.stringify(body),
  })));
}

it("delivers owner-only research with live sessions, bounded states and no execution side effects", async () => {
  const { token } = await issueWebSession(db, secret, account.address, "asker");
  expect((await (await read(token)).json()).status).toBe("awaiting-payment");
  await db.claimPrivatePaymentSubmission(intent.id, account.address);
  await db.confirmPrivatePayment(intent.id, account.address, { source: "circle-facilitator-success", transaction: "synthetic-incoming",
    network: BUYER_NETWORK, payer: account.address, payee: merchants.privatePayee, amountMicros: "50000",
    authorizationId: authorization.authorization.nonce });
  expect((await (await read(token)).json()).status).toBe("awaiting-execution");
  const claim = (await db.claimPrivateResearchExecution(intent.id, account.address))!;
  expect((await (await read(token)).json()).status).toBe("execution-claimed");
  const run: QueryRun = { id: intent.id, question: request.question, budget: 0.03, researchMode: "quick", paymentMode: "real", fundingOwner: "treasury", origin: "a2a",
    engine: "synthetic", createdAt: "2026-09-09T00:00:00.000Z", subClaims: ["Synthetic claim"],
    answer: "Synthetic private answer", decisions: [{ sourceId: "source", sourceName: "Synthetic source", action: "SKIP", rationale: "Insufficient evidence", price: 0.002,
      confidence: 0.5, expectedValue: 0.1, targets: [0], contentReceipt: { internalSecret: "nested-transport-secret" } as never }],
    citations: [], totalSpent: 999, totalToCreators: 999, trace: [{ secret: signature } as never] };
  await db.savePrivateResearchResult(intent.id, account.address, claim.workerId, run);
  const execute = vi.spyOn(db, "claimPrivateResearchExecution");
  const submit = vi.spyOn(db, "claimPrivatePaymentSubmission");
  const publicWrite = vi.spyOn(db, "saveQueryRun");
  const response = await read(token);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const value = await response.json();
  expect(privateWorkspaceResultSchema.parse(value).wallet).toBe(account.address.toLowerCase());
  expect(value).toMatchObject({ status: "completed", result: { answer: run.answer, evidence: null, claimCoverage: null },
    spend: { creator: { confirmedMicros: "0", committedMicros: "0" } } });
  const text = JSON.stringify(value);
  for (const hidden of [signature, authorization.salt, authorization.authorization.nonce, claim.workerId,
    intent.id, "nested-transport-secret", "totalSpent", "totalToCreators", "trace", "contentReceipt"]) expect(text).not.toContain(hidden);
  expect(execute).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled(); expect(publicWrite).not.toHaveBeenCalled();
  const foreign = await issueWebSession(db, secret, merchants.privatePayee, "asker");
  expect((await read(foreign.token)).status).toBe(404);
  expect((await read(token, { id: `prv_${"f".repeat(64)}` })).status).toBe(404);
  const claims = (await parseWebSession(token, secret))!;
  await db.revokeWebSession(webSessionHash(claims.jti), account.address);
  expect((await read(token)).status).toBe(401);
});

it("lists private intents only for a live session owner and keeps cursor and owner selectors out of URLs", async () => {
  const { token } = await issueWebSession(db, secret, account.address, "asker");
  const list = (session?: string, body: unknown = {}, origin = "https://keryx.cc") => storage.run(session, () => history(new Request("https://keryx.cc/api/me/private-jobs/history", {
    method: "POST", headers: { host: "keryx.cc", origin }, body: JSON.stringify(body),
  })));
  expect((await list()).status).toBe(401);
  const response = await list(token);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  const value = privateWorkspaceHistorySchema.parse(await response.json());
  expect(value.wallet).toBe(account.address.toLowerCase()); expect(value.jobs.map(row => row.id)).toEqual([intent.id]);
  for (const hidden of [signature, authorization.salt, authorization.authorization.nonce]) expect(JSON.stringify(value)).not.toContain(hidden);
  expect((await list(token, { wallet: account.address })).status).toBe(400);
  expect((await list(token, { cursor: { id: intent.id, createdAt: "invalid" } })).status).toBe(400);
  expect((await list(token, {}, "https://foreign.example")).status).toBe(403);
  const foreign = await issueWebSession(db, secret, merchants.privatePayee, "asker");
  expect((await (await list(foreign.token)).json()).jobs).toEqual([]);
  const claims = (await parseWebSession(token, secret))!;
  await db.revokeWebSession(webSessionHash(claims.jti), account.address);
  expect((await list(token)).status).toBe(401);
});

it("rejects anonymous, foreign-origin, oversized and caller-selected owners without revealing storage errors", async () => {
  expect((await read()).status).toBe(401);
  const { token } = await issueWebSession(db, secret, account.address, "asker");
  expect((await read(token, { id: intent.id }, "https://foreign.example")).status).toBe(403);
  expect((await read(token, { id: intent.id, payer: account.address })).status).toBe(400);
  expect((await read(token, { id: "x".repeat(2000) })).status).toBe(400);
  const outage = vi.spyOn(db, "getPrivateResearchResult").mockRejectedValue(new Error(signature));
  const response = await read(token); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain(signature); outage.mockRestore();
  const saved = (await db.getPrivateResearchResult(intent.id, account.address))!;
  for (const patch of [{ paymentMode: "offline" }, { decisions: [{ action: "BUY" }] }, { subClaims: [] }, { id: "foreign" }]) {
    const malformed = vi.spyOn(db, "getPrivateResearchResult").mockResolvedValue({ ...saved, serializedRun: JSON.stringify({ ...JSON.parse(saved.serializedRun), ...patch }) });
    expect((await read(token)).status).toBe(503); malformed.mockRestore();
  }
});

it("cancels stalled chunked selector bodies after the deadline", async () => {
  vi.useFakeTimers();
  try {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const request = new Request("https://synthetic.example", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    const rejected = expect(readPrivateResultRequest(request)).rejects.toThrow("deadline");
    await vi.advanceTimersByTimeAsync(5001); await rejected;
    expect(cancel).toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
