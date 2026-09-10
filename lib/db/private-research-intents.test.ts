import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { SqliteAdapter } from "./sqlite-adapter";
import { getSupabasePrivateResearchIntent, reserveSupabasePrivateResearchIntent } from "./private-research-intents";
import { claimSupabasePrivatePayment, confirmSupabasePrivatePayment } from "./private-research-payments";
import type { PrivatePaymentConfirmation } from "../a2a/private-payment-state";
import { claimSupabasePrivateExecution } from "./private-research-executions";
import { saveSupabasePrivateResult } from "./private-research-results";
import type { QueryRun } from "../types";
import { admitSupabasePrivateCreatorSubmission, type PrivateCreatorSubmission } from "./private-creator-submissions";
import { payWithServerSigner } from "../payments/server-x402-client";
import { config } from "../config";
import { confirmSupabasePrivateCreator, type PrivateCreatorConfirmation } from "./private-creator-confirmations";
import { privateCreatorJournal } from "../payments/private-creator-journal";
import { reconcilePrivateCreatorSubmissions } from "../gateway/private-creator-reconciliation";
import { searchCircleTransfer, CIRCLE_X402_TRANSFERS_URL } from "../gateway/x402-transfer-reconciliation";
import { runPrivateResearch } from "../a2a/run-private-research";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { PaymentRequirements } from "../payments/x402-payment-evidence";
import { privateResearchEffects } from "../agent/private-research-effects";
import { privateSpendView } from "../a2a/private-spend-view";
import { privateResultView } from "../a2a/private-result-view";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-private-intents-"));
const file = path.join(directory, "test.sqlite");
const db = new SqliteAdapter(file), other = new SqliteAdapter(file);
await db.init(); await other.init();
const raw = new DatabaseSync(file);
afterAll(() => {
  db.close(); other.close(); raw.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(file + suffix, { force: true });
  fs.rmdirSync(directory);
});

// Ephemeral EOA is never funded or sent to a network. Only synthetic intent data is persisted.
const account = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee, maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const request = { question: "Synthetic private research storage marker", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
const fresh = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
const signature = await account.signTypedData(buyerTypedData(fresh.authorization));
const submission = { request: fresh.request, salt: fresh.salt, payment: { authorization: fresh.authorization, signature } };
const intent = await preparePrivateResearchIntent(submission, requirement, merchants);

it("atomically retains one immutable original across two connections and repeated reservations", async () => {
  const results = await Promise.all([db.reservePrivateResearchIntent(intent), other.reservePrivateResearchIntent(intent)]);
  expect(results).toEqual([intent, intent]);
  expect(raw.prepare("SELECT count(*) AS n FROM private_research_intents WHERE id = ?").get(intent.id)?.n).toBe(1);
  expect(await db.reservePrivateResearchIntent(intent)).toEqual(intent);
  expect(() => raw.prepare("UPDATE private_research_intents SET payer = ? WHERE id = ?").run(merchants.privatePayee, intent.id)).toThrow("immutable");
});

it("scopes reads to the payer and keeps reservations out of public runs and paid orders", async () => {
  await db.reservePrivateResearchIntent(intent);
  expect(await db.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
  expect(await db.getPrivateResearchIntent(intent.id, merchants.privatePayee)).toBeNull();
  expect(await db.getPrivateResearchIntent(`prv_${"0".repeat(64)}`, account.address)).toBeNull();
  await expect(db.getPrivateResearchIntent(intent.id, "")).rejects.toThrow();
  expect(await db.getQueryRun(intent.id)).toBeNull();
  expect(await db.getA2aOrder(intent.id)).toBeNull();
  expect(await db.listRecentQueries(10)).toEqual([]);
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) {
    expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  }
});

it("refuses a changed policy for the same signed identity without replacing the first row", async () => {
  await db.reservePrivateResearchIntent(intent);
  const changed = await preparePrivateResearchIntent(submission, requirement, { ...merchants, publicResearchPayee: `0x${"ef".repeat(20)}` });
  expect(changed.id).toBe(intent.id);
  await expect(other.reservePrivateResearchIntent(changed)).rejects.toThrow("reservation conflict");
  expect(await db.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
});

it("rejects unverified input and corrupted stored identities without exposing parser details", async () => {
  const changed = { ...intent, submission: { ...intent.submission, request: { ...intent.submission.request, question: "Altered" } } };
  await expect(db.reservePrivateResearchIntent(changed)).rejects.toThrow("Invalid stored private research intent");
  const forgedId = `prv_${"1".repeat(64)}`;
  raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES (?,?,?)").run(forgedId, account.address.toLowerCase(), JSON.stringify(intent));
  await expect(db.getPrivateResearchIntent(forgedId, account.address)).rejects.toThrow("owner mismatch");
  const badId = `prv_${"2".repeat(64)}`;
  raw.prepare("INSERT INTO private_research_intents(id,payer,data) VALUES (?,?,?)").run(badId, account.address.toLowerCase(), "not-json");
  await expect(db.getPrivateResearchIntent(badId, account.address)).rejects.toThrow("Invalid stored private research intent");
});

it("recovers the exact saved request, salt, authorization and quote after reopening storage", async () => {
  await db.reservePrivateResearchIntent(intent);
  const reopened = new SqliteAdapter(file);
  try {
    await reopened.init();
    expect(await reopened.getPrivateResearchIntent(intent.id, account.address)).toEqual(intent);
  } finally { reopened.close(); }
});

it("copies trusted quote inputs before awaiting cryptographic verification", async () => {
  const mutable = structuredClone(requirement);
  const pending = preparePrivateResearchIntent(submission, mutable, merchants);
  mutable.amount = "60000";
  expect((await pending).requirement.amount).toBe("50000");
});

it("Supabase SDK binds owner reads, ignores duplicate inserts and confirms the original row", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
    .mockResolvedValueOnce(Response.json([{ data: intent }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await reserveSupabasePrivateResearchIntent(client, intent)).toEqual(intent);
  const insertUrl = new URL(String(http.mock.calls[0][0]));
  expect(insertUrl.pathname).toBe("/rest/v1/private_research_intents");
  expect(insertUrl.searchParams.get("on_conflict")).toBe("id");
  const insert = http.mock.calls[0][1]!;
  expect(insert.method).toBe("POST");
  expect(new Headers(insert.headers).get("prefer")).toContain("resolution=ignore-duplicates");
  expect(JSON.parse(String(insert.body))).toEqual({ id: intent.id, payer: account.address.toLowerCase(), data: intent });
  const readUrl = new URL(String(http.mock.calls[1][0]));
  expect(readUrl.searchParams.get("id")).toBe(`eq.${intent.id}`);
  expect(readUrl.searchParams.get("payer")).toBe(`eq.${account.address.toLowerCase()}`);
  expect(http.mock.calls[1][1]?.method).toBe("GET");
});

it("Supabase outages and missing or foreign readbacks cannot claim a successful reservation", async () => {
  for (const replies of [
    [new Response("{}", { status: 503 })],
    [new Response(null, { status: 201 }), Response.json([])],
    [new Response(null, { status: 201 }), Response.json([{ data: { ...intent, id: `prv_${"3".repeat(64)}` } }])],
  ]) {
    const http = vi.fn<typeof fetch>();
    for (const reply of replies) http.mockResolvedValueOnce(reply);
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    await expect(reserveSupabasePrivateResearchIntent(client, intent)).rejects.toThrow();
  }
  const http = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 503 }));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  await expect(getSupabasePrivateResearchIntent(client, intent.id, account.address)).rejects.toThrow("storage unavailable");
});

// Synthetic confirmation fixtures exercise storage, not real Circle settlement.
const confirmation: PrivatePaymentConfirmation = {
  source: "circle-facilitator-success", transaction: "synthetic-transfer-reference",
  network: BUYER_NETWORK, payer: account.address, payee: merchants.privatePayee,
  amountMicros: requirement.amount, authorizationId: fresh.authorization.nonce,
};

it("grants one durable submission claim across two connections and never reclaims after a restart", async () => {
  await db.reservePrivateResearchIntent(intent);
  expect(await db.getPrivatePaymentState(intent.id, account.address)).toBeNull();
  const claims = await Promise.all([db.claimPrivatePaymentSubmission(intent.id, account.address), other.claimPrivatePaymentSubmission(intent.id, account.address)]);
  expect(claims.filter(result => result.claimed)).toHaveLength(1);
  expect(claims.every(result => result.state.status === "pending")).toBe(true);
  const reopened = new SqliteAdapter(file);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  try {
    await reopened.init();
    expect(await reopened.claimPrivatePaymentSubmission(intent.id, account.address)).toMatchObject({ claimed: false, state: { status: "pending", confirmation: null } });
  } finally { vi.useRealTimers(); reopened.close(); }
});

it("rejects another payer and mismatched confirmation tuples without promoting pending state", async () => {
  expect(await db.getPrivatePaymentState(intent.id, merchants.privatePayee)).toBeNull();
  await expect(db.claimPrivatePaymentSubmission(intent.id, merchants.privatePayee)).rejects.toThrow("intent unavailable");
  await expect(db.confirmPrivatePayment(intent.id, merchants.privatePayee, confirmation)).rejects.toThrow("intent unavailable");
  for (const altered of [
    { ...confirmation, payer: merchants.privatePayee }, { ...confirmation, payee: merchants.publicResearchPayee },
    { ...confirmation, amountMicros: "60000" }, { ...confirmation, authorizationId: `0x${"4".repeat(64)}` },
    { ...confirmation, transaction: "" }, { ...confirmation, network: "eip155:1" },
  ]) await expect(db.confirmPrivatePayment(intent.id, account.address, altered as PrivatePaymentConfirmation)).rejects.toThrow("confirmation mismatch");
  expect(await db.getPrivatePaymentState(intent.id, account.address)).toMatchObject({ status: "pending" });
});

it("retains one confirmed reference, acknowledges exact retries and rejects conflicting references", async () => {
  const settled = await db.confirmPrivatePayment(intent.id, account.address, confirmation);
  expect(settled).toMatchObject({ status: "settled", confirmation: { transaction: confirmation.transaction, payer: account.address.toLowerCase() } });
  expect(await other.confirmPrivatePayment(intent.id, account.address, confirmation)).toEqual(settled);
  await expect(other.confirmPrivatePayment(intent.id, account.address, { ...confirmation, transaction: "another-reference" })).rejects.toThrow("confirmation conflict");
  expect(await db.claimPrivatePaymentSubmission(intent.id, account.address)).toEqual({ claimed: false, state: settled });
});

it("cannot confirm a reservation that never crossed the durable submission boundary", async () => {
  const next = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
  const nextSignature = await account.signTypedData(buyerTypedData(next.authorization));
  const nextIntent = await preparePrivateResearchIntent({ request: next.request, salt: next.salt, payment: { authorization: next.authorization, signature: nextSignature } }, requirement, merchants);
  await db.reservePrivateResearchIntent(nextIntent);
  await expect(db.confirmPrivatePayment(nextIntent.id, account.address, { ...confirmation, authorizationId: next.authorization.nonce })).rejects.toThrow("confirmation conflict");
  expect(await db.getPrivatePaymentState(nextIntent.id, account.address)).toBeNull();
});

it("Supabase claims through the restricted RPC and requires valid readback before authorizing submission", async () => {
  const pending = { started_at: "2026-09-09T00:00:00.000Z", confirmation: null, settled_at: null };
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([pending]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await claimSupabasePrivatePayment(client, intent.id, account.address)).toMatchObject({ claimed: true, state: { status: "pending" } });
  expect(String(http.mock.calls[1][0])).toContain("/rpc/claim_private_research_payment");
  expect(JSON.parse(String(http.mock.calls[1][1]?.body))).toEqual({ p_id: intent.id, p_payer: account.address.toLowerCase() });
  const broken = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(new Response("{}", { status: 503 }));
  const unavailable = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: broken }, auth: { persistSession: false } });
  await expect(claimSupabasePrivatePayment(unavailable, intent.id, account.address)).rejects.toThrow();
});

it("Supabase does not report confirmation from an RPC success without confirmed readback", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([{ started_at: "2026-09-09T00:00:00.000Z", confirmation: null, settled_at: null }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  await expect(confirmSupabasePrivatePayment(client, intent.id, account.address, confirmation)).rejects.toThrow("confirmation conflict");
  expect(String(http.mock.calls[1][0])).toContain("/rpc/confirm_private_research_payment");
});

it("a newly inserted claim cannot authorize submission if readback already shows settlement", async () => {
  const http = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json(true))
    .mockResolvedValueOnce(Response.json([{ data: intent }]))
    .mockResolvedValueOnce(Response.json([{ started_at: "2026-09-09T00:00:00.000Z", confirmation,
      settled_at: "2026-09-09T00:00:01.000Z" }]));
  const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
  expect(await claimSupabasePrivatePayment(client, intent.id, account.address)).toMatchObject({ claimed: false, state: { status: "settled" } });
});

async function executionFixture(requestValue: unknown = request) {
  const next = await createPrivateAuthorization(requestValue, requirement, account.address, merchants, 1788912000000);
  const signature = await account.signTypedData(buyerTypedData(next.authorization));
  const value = await preparePrivateResearchIntent({ request: next.request, salt: next.salt, payment: { authorization: next.authorization, signature } }, requirement, merchants);
  await db.reservePrivateResearchIntent(value);
  return { value, proof: { ...confirmation, authorizationId: next.authorization.nonce } };
}

it("requires confirmed payment before execution and grants only one worker across connections and restarts", async () => {
  const { value, proof } = await executionFixture();
  await expect(db.claimPrivateResearchExecution(value.id, account.address)).rejects.toThrow("Settled private payment unavailable");
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await expect(db.claimPrivateResearchExecution(value.id, account.address)).rejects.toThrow("Settled private payment unavailable");
  expect(await db.getPrivateResearchExecution(value.id, account.address)).toBeNull();
  await db.confirmPrivatePayment(value.id, account.address, proof);
  await expect(other.claimPrivateResearchExecution(value.id, merchants.privatePayee)).rejects.toThrow("Settled private payment unavailable");
  const claims = await Promise.all([db.claimPrivateResearchExecution(value.id, account.address), other.claimPrivateResearchExecution(value.id, account.address)]);
  const accepted = claims.filter(Boolean);
  expect(accepted).toHaveLength(1);
  expect(accepted[0]).toMatchObject({ id: value.id, workerId: expect.any(String), startedAt: expect.any(String) });
  expect(await db.getPrivateResearchExecution(value.id, merchants.privatePayee)).toBeNull();
  const reopened = new SqliteAdapter(file);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  try {
    await reopened.init();
    expect(await reopened.claimPrivateResearchExecution(value.id, account.address)).toBeNull();
    expect(await reopened.getPrivateResearchExecution(value.id, account.address)).toEqual(accepted[0]);
  } finally { vi.useRealTimers(); reopened.close(); }
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) {
    expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  }
});

it("refuses corrupt payment or worker state instead of granting execution", async () => {
  const { value, proof } = await executionFixture();
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  const original = raw.prepare("SELECT confirmation FROM private_research_payment_attempts WHERE id=?").get(value.id)!;
  raw.prepare("UPDATE private_research_payment_attempts SET confirmation=? WHERE id=?").run("{}", value.id);
  await expect(db.claimPrivateResearchExecution(value.id, account.address)).rejects.toThrow("Invalid private payment state");
  expect(raw.prepare("SELECT id FROM private_research_executions WHERE id=?").get(value.id)).toBeUndefined();
  raw.prepare("UPDATE private_research_payment_attempts SET confirmation=? WHERE id=?").run(String(original.confirmation), value.id);
  await db.claimPrivateResearchExecution(value.id, account.address);
  raw.prepare("UPDATE private_research_executions SET worker_id=? WHERE id=?").run("invalid", value.id);
  await expect(db.getPrivateResearchExecution(value.id, account.address)).rejects.toThrow("Invalid private execution state");
  expect(await db.claimPrivateResearchExecution(value.id, account.address)).toBeNull();
});

it("Supabase requires a fresh RPC claim and matching validated readback; lost responses never authorize execution", async () => {
  const settled = { started_at: "2026-09-09T00:00:00.000Z", confirmation, settled_at: "2026-09-09T00:00:01.000Z" };
  for (const outcome of ["fresh", "duplicate", "lost-rpc", "lost-readback", "wrong-worker"] as const) {
    let workerId = "";
    const http = vi.fn<typeof fetch>(async (url, options) => {
      const route = new URL(String(url)).pathname;
      if (route.endsWith("/private_research_intents")) return Response.json([{ data: intent }]);
      if (route.endsWith("/private_research_payment_attempts")) return Response.json([settled]);
      if (route.endsWith("/rpc/claim_private_research_execution")) {
        const body = JSON.parse(String(options?.body));
        expect(body).toEqual({ p_id: intent.id, p_payer: account.address.toLowerCase(), p_worker_id: expect.any(String) });
        workerId = body.p_worker_id;
        return outcome === "lost-rpc" ? new Response("{}", { status: 503 }) : Response.json(outcome !== "duplicate");
      }
      if (route.endsWith("/private_research_executions")) {
        expect(new URL(String(url)).searchParams.get("id")).toBe(`eq.${intent.id}`);
        if (outcome === "lost-readback") return new Response("{}", { status: 503 });
        return Response.json([{ worker_id: outcome === "wrong-worker" ? "00000000-0000-4000-8000-000000000000" : workerId, started_at: settled.settled_at }]);
      }
      throw new Error("Unexpected synthetic request");
    });
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    const result = claimSupabasePrivateExecution(client, intent.id, account.address);
    if (outcome === "fresh") expect(await result).toEqual({ id: intent.id, workerId, startedAt: settled.settled_at });
    else if (outcome === "duplicate") expect(await result).toBeNull();
    else await expect(result).rejects.toThrow();
    expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/"))).toHaveLength(1);
  }
});

function syntheticResult(id: string): QueryRun {
  return { id, question: request.question, budget: request.budget, researchMode: "quick",
    engine: "heuristic", subClaims: [], decisions: [], citations: [], answer: "Private synthetic result marker",
    totalSpent: 0, totalToCreators: 0, trace: [], createdAt: "2026-09-09T00:00:00.000Z", paymentMode: "offline" };
}

function creatorSubmission(nonceByte: string, sourceId: string, amountMicros = "20000"): PrivateCreatorSubmission {
  return { kind: "citation", sourceId, itemId: null, submission: { authorizationId: `0x${nonceByte.repeat(64)}`,
    authorizationExpiresAt: "2033-05-18T03:33:20.000Z", payer: merchants.privatePayee, payee: merchants.publicResearchPayee,
    amountMicros, network: BUYER_NETWORK, asset: BUYER_USDC } };
}
async function creatorFixture() {
  const { value, proof } = await executionFixture();
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  const claim = (await db.claimPrivateResearchExecution(value.id, account.address))!;
  return { value, claim };
}

const reasoningPolicy = { modelId: "deepseek-flash", provider: "deepseek" as const, wireModel: "deepseek-v4-flash",
  endpoint: "https://synthetic.example/v1/chat/completions", fallback: "local-heuristic" as const, redirects: "prohibited" as const };

it("retains signed provider disclosure and denies missing or changed execution policy before funding or reasoning", async () => {
  const { value, proof } = await executionFixture({ ...request, model: reasoningPolicy.modelId, reasoning: reasoningPolicy });
  expect((await other.getPrivateResearchIntent(value.id, account.address))?.submission.request).toMatchObject({ reasoning: reasoningPolicy });
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  const balance = vi.fn(async () => BigInt(30000)), engine = vi.fn();
  const options = { signerAddress: merchants.privatePayee, signer: { createPaymentPayload: vi.fn() }, getGatewayBalance: balance, engineForModel: engine };
  await expect(runPrivateResearch(db, value.id, account.address, options)).rejects.toThrow("does not match");
  await expect(runPrivateResearch(db, value.id, account.address, { ...options, reasoningPolicy: { ...reasoningPolicy, endpoint: "https://other.example/chat/completions" } })).rejects.toThrow("does not match");
  expect(balance).not.toHaveBeenCalled(); expect(engine).not.toHaveBeenCalled();
  expect(await db.getPrivateResearchExecution(value.id, account.address)).toBeNull();
});

it("projects owner spend from late durable evidence without using stale result totals or disclosing authorization", async () => {
  const { value, claim } = await creatorFixture();
  const statuses = [null, "received", "batched", "confirmed", "completed", "facilitator"] as const;
  const legs = statuses.map((_, index) => ({ ...creatorSubmission("0", `spend-view-source-${index}`, "3001"),
    submission: { ...creatorSubmission("0", "unused", "3001").submission,
      authorizationId: `0x${(900 + index).toString(16).padStart(64, "0")}` } }));
  for (const leg of legs) expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg)).toBe(true);
  const snapshot = await db.savePrivateResearchResult(value.id, account.address, claim.workerId, syntheticResult(value.id));
  const pending = await privateSpendView(db, value.id, account.address);
  expect(pending?.creator).toMatchObject({ committedMicros: "18006", unresolvedMicros: "18006", confirmedMicros: "0" });
  for (let index = 1; index < statuses.length; index++) {
    const status = statuses[index];
    const proof: PrivateCreatorConfirmation = status === "facilitator"
      ? { source: "circle-facilitator-success", transaction: `synthetic-view-${index}`, submission: legs[index].submission }
      : { source: "circle-transfer-search", transaction: `synthetic-view-${index}`, submission: legs[index].submission, transferStatus: status! };
    await db.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, proof);
  }
  const view = await privateSpendView(other, value.id, account.address);
  expect(view).toMatchObject({ chainFinalityVerified: false, incoming: { status: "settled", priceMicros: "50000" },
    creator: { budgetMicros: "30000", committedMicros: "18006", unresolvedMicros: "3001", processingMicros: "6002",
      confirmedMicros: "9003", uncommittedMicros: "11994" } });
  expect(view?.creator.payments.map(payment => payment.status).sort()).toEqual(
    ["unresolved", "received", "batched", "confirmed", "completed", "facilitator-confirmed"].sort());
  expect(await db.getPrivateResearchResult(value.id, account.address)).toEqual(snapshot);
  const serialized = JSON.stringify(view);
  for (const secret of [value.id, claim.workerId, value.submission.salt, value.submission.payment.signature,
    value.submission.payment.authorization.nonce, request.question, syntheticResult(value.id).answer,
    ...legs.map(leg => leg.submission.authorizationId)]) expect(serialized).not.toContain(secret);
  expect(await privateSpendView(db, value.id, merchants.privatePayee)).toBeNull();
  const reader = { getPrivateResearchIntent: db.getPrivateResearchIntent.bind(db), getPrivatePaymentState: db.getPrivatePaymentState.bind(db),
    listPrivateCreatorSubmissions: db.listPrivateCreatorSubmissions.bind(db),
    getPrivateCreatorConfirmation: vi.fn().mockRejectedValue(new Error("synthetic confirmation outage")) };
  await expect(privateSpendView(reader, value.id, account.address)).rejects.toThrow("synthetic confirmation outage");
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  try { expect((await privateSpendView(db, value.id, account.address))?.creator).toEqual(view?.creator); }
  finally { vi.useRealTimers(); }
});

it("distinguishes a private price commitment from incoming payment and denies nonowners before ledger reads", async () => {
  const { value } = await executionFixture();
  expect((await privateSpendView(db, value.id, account.address))?.incoming).toMatchObject({ status: "not-submitted", priceMicros: "50000", reference: null });
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  expect((await privateSpendView(db, value.id, account.address))?.incoming).toMatchObject({ status: "pending", reference: null });
  const forbidden = vi.fn().mockRejectedValue(new Error("must not read"));
  expect(await privateSpendView({ getPrivateResearchIntent: db.getPrivateResearchIntent.bind(db), getPrivatePaymentState: forbidden,
    listPrivateCreatorSubmissions: forbidden, getPrivateCreatorConfirmation: forbidden }, value.id, merchants.privatePayee)).toBeNull();
  expect(forbidden).not.toHaveBeenCalled();
});

it("keeps private caches local and accepts payment observations only against durable admitted/confirmed evidence", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("2", "effects-source");
  await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg);
  const context = { id: value.id, payer: account.address, workerId: claim.workerId };
  await expect(privateResearchEffects(db, { ...context, workerId: "wrong" })).rejects.toThrow("authority unavailable");
  const first = await privateResearchEffects(db, context), second = await privateResearchEffects(db, context);
  await first.effects.setCached("asset", "Private cache marker");
  expect(await first.effects.getCached("asset")).toBe("Private cache marker");
  expect(await second.effects.getCached("asset")).toBeNull();
  expect(await first.effects.discoverExternal("Private question", [])).toEqual([]);
  expect(await first.effects.decisionContext("Private question", [])).toEqual({ sample: 0 });
  const payment = { kind: "citation" as const, queryId: value.id, sourceId: leg.sourceId, sourceName: "Source", payer: leg.submission.payer,
    payee: leg.submission.payee, amountUsdc: 0.02, network: BUYER_NETWORK, settled: false, settlementStatus: "pending" as const,
    authorizationId: leg.submission.authorizationId, authorizationExpiresAt: leg.submission.authorizationExpiresAt, createdAt: "2026-09-09T00:00:00.000Z" };
  await first.effects.recordPayment(payment);
  await expect(first.effects.recordPayment({ ...payment, amountUsdc: 0.03 })).rejects.toThrow("mismatch");
  await expect(first.effects.recordPayment({ ...payment, settled: true, settlementStatus: "settled", txHash: "synthetic-effect-reference" })).rejects.toThrow("requires recovery");
  await expect(first.effects.recordPayment({ ...payment, settlementStatus: "simulated" })).rejects.toThrow("mismatch");
  await db.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, { source: "circle-facilitator-success", transaction: "synthetic-effect-reference", submission: leg.submission });
  await first.effects.recordPayment({ ...payment, settled: true, settlementStatus: "settled", txHash: "synthetic-effect-reference" });
  first.effects.alert("Private alert marker", "Private alert body");
  expect(first.diagnostics.alerts).toBe(1);
  expect(JSON.stringify(first.diagnostics)).not.toContain("Private alert");
  await first.effects.saveQueryRun(syntheticResult(value.id));
  expect(await first.effects.getCached("asset")).toBeNull();
});

it("denies unpaid or underfunded execution before a worker claim or any reasoning", async () => {
  const { value, proof } = await executionFixture();
  const options = { signerAddress: merchants.privatePayee, signer: { createPaymentPayload: vi.fn() },
    getGatewayBalance: vi.fn(async () => BigInt(0)), engineForModel: vi.fn() };
  await expect(runPrivateResearch(db, value.id, account.address, options)).rejects.toThrow("Settled private payment unavailable");
  expect(options.getGatewayBalance).not.toHaveBeenCalled();
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  await expect(runPrivateResearch(db, value.id, account.address, options)).rejects.toThrow("prefunding");
  expect(await db.getPrivateResearchExecution(value.id, account.address)).toBeNull();
  expect(options.engineForModel).not.toHaveBeenCalled();
  expect(options.signer.createPaymentPayload).not.toHaveBeenCalled();
  await db.claimPrivateResearchExecution(value.id, account.address);
  options.getGatewayBalance.mockClear();
  expect(await runPrivateResearch(db, value.id, account.address, options)).toEqual({ status: "already-claimed" });
  expect(options.getGatewayBalance).not.toHaveBeenCalled();
});

it("runs one complete private job with durable source/reward receipts and no shared research effects", async () => {
  const { value, proof } = await executionFixture({ ...request, model: reasoningPolicy.modelId, reasoning: reasoningPolicy });
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  await db.upsertSource({ id: "private-pipeline-source", name: "Pipeline source", description: "Research evidence", tags: ["research"],
    url: "https://synthetic.example/source", walletAddress: merchants.publicResearchPayee, authors: [], fetchPrice: 0.002,
    createdAt: "2026-09-09T00:00:00.000Z", verified: true });
  const spies = [db, other].flatMap(connection => (["recordPayment", "saveQueryRun", "getCached", "getCachedAt", "setCached", "saveQueryMemory", "loadQueryMemories",
    "recordActivationEvent", "getSourceNotify", "getSourceNotifyEmail"] as const)
    .map(method => vi.spyOn(connection, method).mockRejectedValue(new Error("Shared private effect forbidden"))));
  const decompose = vi.fn(async () => ["The synthetic research claim"]);
  const engine: ReasoningEngine = { name: "synthetic-private-engine", decompose,
    decide: async input => input.candidates.map(c => ({ sourceId: c.id, sourceName: c.name, action: "BUY", expectedValue: 0.9,
      price: c.fetchPrice, confidence: 0.9, rationale: "Synthetic evidence purchase", targets: [0] })),
    sufficiency: async input => ({ sufficient: true, rationale: "Synthetic evidence is sufficient", perClaim: input.subClaims.map(claim => ({ claim, coverage: 0.9, coveredBy: input.gathered.map(g => g.marker) })) }),
    reevaluate: async () => ({ claims: [], shouldBuyMore: false, recommendedIds: [], rationale: "No further sources" }),
    synthesize: async input => ({ answer: `Synthetic cited answer ${input.gathered.map(g => `[${g.marker}]`).join(" ")}`,
      citedMarkers: input.gathered.map(g => g.marker), conflicts: [], evidence: input.gathered.map(g => ({ claimIndex: 0, marker: g.marker, quote: g.text, support: 0.9 })) }),
    attribute: async input => input.used.map(source => ({ sourceId: source.sourceId, weight: 1 / input.used.length, rationale: "Synthetic contribution" })),
  };
  let nonceIndex = 80;
  const signer = { createPaymentPayload: vi.fn(async (_version: number, terms: PaymentRequirements) => ({ x402Version: 2, payload: {
    signature: "synthetic-unfunded-signature", authorization: { from: merchants.privatePayee, to: terms.payTo, value: terms.amount,
      nonce: `0x${(++nonceIndex).toString(16).padStart(64, "0")}`, validBefore: "2000000000" } } })) };
  const http = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), "https://synthetic.example");
    expect(["/api/source/private-pipeline-source", "/api/cite/private-pipeline-source"]).toContain(url.pathname);
    if (!new Headers(init?.headers).has("Payment-Signature")) {
      const amount = url.pathname.includes("/cite/") ? String(Math.round(Number(url.searchParams.get("amount")) * 1e6)) : "2000";
      return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2,
        accepts: [{ ...requirement, amount, payTo: merchants.publicResearchPayee, maxTimeoutSeconds: config.maxTimeoutSeconds }] })).toString("base64") } });
    }
    return Response.json({ content: "This synthetic source contains detailed evidence supporting the research claim for a private test job.", ok: true }, { headers: {
      "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: `synthetic-pipeline-${nonceIndex}`, payer: merchants.privatePayee, network: BUYER_NETWORK })).toString("base64"),
    } });
  });
  const previousBase = config.baseUrl;
  Object.assign(config, { baseUrl: "https://synthetic.example" });
  vi.stubGlobal("fetch", http);
  try {
    const options = { signerAddress: merchants.privatePayee, signer, reasoningPolicy, getGatewayBalance: vi.fn(async () => BigInt(30000)), engineForModel: vi.fn(() => engine) };
    const outcomes = await Promise.all([runPrivateResearch(db, value.id, account.address, options), runPrivateResearch(other, value.id, account.address, options)]);
    expect(outcomes.map(outcome => outcome.status).sort()).toEqual(["already-claimed", "completed"]);
    const complete = outcomes.find(outcome => outcome.status === "completed")!;
    if (complete.status !== "completed") throw new Error("Expected completion");
    expect(complete.run.citations, complete.run.trace.map(step => step.message.replaceAll(value.id, "[synthetic job]")).join("\n")).toHaveLength(1);
    expect(complete.run.question).toBe(value.submission.request.question);
    expect(complete.run.totalSpent).toBeCloseTo(0.017, 6);
    expect(complete.diagnostics).toEqual({ alerts: 0, suppressedCitationNotifications: 1 });
    const ownerResult = await privateResultView(other, value.id, account.address);
    expect(ownerResult).toMatchObject({ status: "completed", result: { answer: complete.run.answer,
      decisions: complete.run.decisions.map(({ sourceId, action, rationale }) => expect.objectContaining({ sourceId, action, rationale })) },
      spend: { creator: { confirmedMicros: "17000", unresolvedMicros: "0" } } });
    expect(await privateResultView(db, value.id, merchants.publicResearchPayee)).toBeNull();
    expect(JSON.stringify(ownerResult)).not.toContain(value.submission.payment.signature);
    expect(ownerResult?.result).not.toHaveProperty("trace");
    const legs = await db.listPrivateCreatorSubmissions(value.id, account.address);
    expect(legs).toHaveLength(2);
    for (const leg of legs) expect(await db.getPrivateCreatorConfirmation(value.id, account.address, leg.data.submission.authorizationId)).not.toBeNull();
    expect(await runPrivateResearch(db, value.id, account.address, options)).toMatchObject({ status: "stored" });
    expect(decompose).toHaveBeenCalledTimes(1);
    expect(signer.createPaymentPayload).toHaveBeenCalledTimes(2);
    expect(http).toHaveBeenCalledTimes(4);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(await db.getPrivateResearchResult(value.id, merchants.publicResearchPayee)).toBeNull();
    for (const table of ["query_runs", "a2a_orders", "payment_events", "cache_items"]) expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  } finally { Object.assign(config, { baseUrl: previousBase }); for (const spy of spies) spy.mockRestore(); vi.unstubAllGlobals(); }
});

it("reconciles a durable private attempt after reopening using complete Circle pagination and retained search provenance", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("4", "reconciliation-source");
  await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg);
  const transfer = { id: "synthetic-recovered-transfer", status: "received", token: "USDC", sendingNetwork: BUYER_NETWORK,
    recipientNetwork: BUYER_NETWORK, fromAddress: leg.submission.payer, toAddress: leg.submission.payee,
    amount: leg.submission.amountMicros, nonce: leg.submission.authorizationId, txHash: null,
    createdAt: "2026-09-09T00:00:00.000Z", updatedAt: "2026-09-09T00:00:00.000Z" };
  const http = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ transfers: [{ ...transfer, nonce: `0x${"5".repeat(64)}` }] },
    { headers: { Link: `<${CIRCLE_X402_TRANSFERS_URL}?pageAfter=synthetic-cursor>; rel="next"` } }))
    .mockResolvedValueOnce(Response.json({ transfers: [transfer] }));
  const reopened = new SqliteAdapter(file);
  try {
    await reopened.init();
    expect(await reconcilePrivateCreatorSubmissions(reopened, value.id, account.address, { search: (payment, signal) => searchCircleTransfer(payment, signal, http) }))
      .toMatchObject({ confirmed: 1, unavailable: 0 });
    expect(await reopened.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).toMatchObject({ confirmation: {
      source: "circle-transfer-search", transaction: transfer.id, transferStatus: "received", submission: leg.submission } });
    const skip = vi.fn();
    expect(await reconcilePrivateCreatorSubmissions(reopened, value.id, account.address, { search: skip })).toMatchObject({ alreadyConfirmed: 1 });
    expect(skip).not.toHaveBeenCalled();
  } finally { reopened.close(); }
  expect(http).toHaveBeenCalledTimes(2);
  expect(new URL(String(http.mock.calls[1][0])).searchParams.get("pageAfter")).toBe("synthetic-cursor");
  for (const [url, options] of http.mock.calls) {
    expect(JSON.stringify([url, options])).not.toContain(value.id);
    expect(JSON.stringify([url, options])).not.toContain(leg.sourceId);
    expect(new Headers(options?.headers).has("Payment-Signature")).toBe(false);
  }
});

it("recovers a confirmed paid 5xx into the private ledger after a storage outage without repeating signed HTTP", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("3", "confirmed-transport-source");
  const journal = privateCreatorJournal({ admitPrivateCreatorSubmission: db.admitPrivateCreatorSubmission.bind(db),
    confirmPrivateCreatorSubmission: vi.fn().mockRejectedValueOnce(new Error("synthetic storage outage"))
      .mockImplementation(db.confirmPrivateCreatorSubmission.bind(db)) },
    { id: value.id, payer: account.address, workerId: claim.workerId, kind: leg.kind, sourceId: leg.sourceId, itemId: leg.itemId });
  const quote = { ...requirement, amount: "20000", payTo: leg.submission.payee, maxTimeoutSeconds: config.maxTimeoutSeconds };
  const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 402, headers: {
    "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [quote] })).toString("base64"),
  } })).mockResolvedValueOnce(new Response("{}", { status: 500, headers: {
    "PAYMENT-RESPONSE": Buffer.from(JSON.stringify({ success: true, transaction: "synthetic-paid-500", payer: leg.submission.payer, network: BUYER_NETWORK })).toString("base64"),
  } }));
  const signer = { createPaymentPayload: vi.fn(async () => ({ x402Version: 2, payload: { signature: "synthetic-unfunded-signature",
    authorization: { from: leg.submission.payer, to: leg.submission.payee, value: "20000", nonce: leg.submission.authorizationId, validBefore: "2000000000" } } })) };
  const observed = await payWithServerSigner({ url: "https://synthetic.example/paid", method: "POST", expectedPayee: leg.submission.payee,
    expectedAmount: 0.02, payer: leg.submission.payer, signer, fetchImpl, beforeSubmit: journal.beforeSubmit });
  expect(await journal.recordOutcome(observed)).toMatchObject({ journalStatus: "confirmation-unpersisted", attempt: { settlementStatus: "settled", delivered: false, transaction: "synthetic-paid-500" } });
  expect(await db.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).toBeNull();
  expect(await journal.recordOutcome(observed)).toMatchObject({ journalStatus: "confirmed", attempt: { settlementStatus: "settled", delivered: false } });
  expect(await db.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).toMatchObject({ confirmation: { transaction: "synthetic-paid-500" } });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(signer.createPaymentPayload).toHaveBeenCalledTimes(1);
});

it("confirms only an admitted matching creator tuple and retains the first receipt without reopening budget", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("6", "confirmation-source");
  const proof: PrivateCreatorConfirmation = { source: "circle-facilitator-success", transaction: "synthetic-creator-reference", submission: leg.submission };
  await expect(db.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, proof)).rejects.toThrow("submission unavailable");
  expect(await db.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).toBeNull();
  await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg);
  await expect(db.confirmPrivateCreatorSubmission(value.id, merchants.publicResearchPayee, claim.workerId, proof)).rejects.toThrow("submission unavailable");
  await expect(db.confirmPrivateCreatorSubmission(value.id, account.address, "wrong-worker", proof)).rejects.toThrow("submission unavailable");
  for (const patch of [{ amountMicros: "20001" }, { payer: merchants.publicResearchPayee }, { payee: merchants.privatePayee }, { authorizationExpiresAt: "2040-01-01T00:00:00.000Z" }]) {
    await expect(db.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, { ...proof, submission: { ...proof.submission, ...patch } })).rejects.toThrow("confirmation mismatch");
  }
  // Late confirmation can follow result persistence; it does not execute or rewrite the result.
  await db.savePrivateResearchResult(value.id, account.address, claim.workerId, syntheticResult(value.id));
  const saved = await db.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, proof);
  expect(saved.confirmation).toEqual(proof);
  expect(await other.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, proof)).toEqual(saved);
  await expect(other.confirmPrivateCreatorSubmission(value.id, account.address, claim.workerId, { ...proof, transaction: "replacement" })).rejects.toThrow("confirmation conflict");
  expect(await db.getPrivateCreatorConfirmation(value.id, merchants.publicResearchPayee, leg.submission.authorizationId)).toBeNull();
  const reopened = new SqliteAdapter(file);
  try { await reopened.init(); expect(await reopened.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).toEqual(saved); }
  finally { reopened.close(); }
  expect((await db.listPrivateCreatorSubmissions(value.id, account.address)).map(row => row.data.submission.amountMicros)).toEqual(["20000"]);
  expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg)).toBe(false);
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
  raw.prepare("UPDATE private_creator_confirmations SET data=? WHERE authorization_id=?").run("{}", leg.submission.authorizationId);
  await expect(db.getPrivateCreatorConfirmation(value.id, account.address, leg.submission.authorizationId)).rejects.toThrow("Invalid private creator confirmation state");
});

it("Supabase never acknowledges creator confirmation without exact owner-scoped readback", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("0", "supabase-confirmation-source");
  await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg);
  const [stored] = await db.listPrivateCreatorSubmissions(value.id, account.address);
  const date = "2026-09-09T00:00:00.000Z";
  const proof: PrivateCreatorConfirmation = { source: "circle-facilitator-success", transaction: "synthetic-supabase-reference", submission: leg.submission };
  for (const outcome of ["saved", "missing", "conflicting", "rpc-outage", "read-outage"] as const) {
    const http = vi.fn<typeof fetch>(async (url, options) => {
      const route = new URL(String(url)).pathname;
      if (route.endsWith("/private_research_intents")) return Response.json([{ data: value }]);
      if (route.endsWith("/private_research_payment_attempts")) return Response.json([{ started_at: date, settled_at: date,
        confirmation: { ...confirmation, authorizationId: value.submission.payment.authorization.nonce } }]);
      if (route.endsWith("/private_research_executions")) return Response.json([{ worker_id: claim.workerId, started_at: date }]);
      if (route.endsWith("/private_creator_submissions")) return Response.json([{ leg_id: stored.legId, worker_id: claim.workerId,
        authorization_id: leg.submission.authorizationId, amount_micros: 20000, data: leg, started_at: date }]);
      if (route.endsWith("/rpc/confirm_private_creator_submission")) {
        expect(JSON.parse(String(options?.body))).toEqual({ p_id: value.id, p_payer: account.address.toLowerCase(), p_worker_id: claim.workerId, p_confirmation: proof });
        return new Response(null, { status: outcome === "rpc-outage" ? 503 : 204 });
      }
      if (route.endsWith("/private_creator_confirmations")) {
        expect(new URL(String(url)).searchParams.get("authorization_id")).toBe(`eq.${leg.submission.authorizationId}`);
        if (outcome === "read-outage") return new Response("{}", { status: 503 });
        return Response.json(outcome === "missing" ? [] : [{ data: outcome === "conflicting" ? { ...proof, transaction: "other-reference" } : proof, settled_at: date }]);
      }
      throw new Error("Unexpected synthetic request");
    });
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    const pending = confirmSupabasePrivateCreator(client, value.id, account.address, claim.workerId, proof);
    if (outcome === "saved") expect(await pending).toEqual({ confirmation: proof, settledAt: date });
    else await expect(pending).rejects.toThrow();
    expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/"))).toHaveLength(1);
  }
});

it("atomically caps concurrent creator admissions and never readmits an existing leg, nonce or expired attempt", async () => {
  const { value, claim } = await creatorFixture();
  const first = creatorSubmission("a", "creator-a"), second = creatorSubmission("b", "creator-b");
  const replies = await Promise.all([db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, first),
    other.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, second)]);
  expect(replies.filter(Boolean)).toHaveLength(1);
  const original = replies[0] ? first : second;
  expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, { ...original, submission: { ...original.submission, authorizationId: `0x${"c".repeat(64)}`, amountMicros: "1000" } })).toBe(false);
  expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, creatorSubmission("d", "creator-d", "10000"))).toBe(true);
  expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, creatorSubmission("e", "creator-e", "1"))).toBe(false);
  const records = await db.listPrivateCreatorSubmissions(value.id, account.address);
  expect(records).toHaveLength(2);
  expect(records.reduce((sum, row) => sum + Number(row.data.submission.amountMicros), 0)).toBe(30000);
  expect(await db.listPrivateCreatorSubmissions(value.id, merchants.publicResearchPayee)).toEqual([]);
  const reopened = new SqliteAdapter(file);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2040-01-01T00:00:00Z"));
  try {
    await reopened.init();
    expect(await reopened.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, original)).toBe(false);
    expect(await reopened.listPrivateCreatorSubmissions(value.id, account.address)).toEqual(records);
  } finally { vi.useRealTimers(); reopened.close(); }
  const next = await creatorFixture();
  expect(await db.admitPrivateCreatorSubmission(next.value.id, account.address, next.claim.workerId, original)).toBe(false);
});

it("rejects foreign workers, malformed evidence and new creator payments after result persistence", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("f", "source-f");
  await expect(db.admitPrivateCreatorSubmission(value.id, account.address, "wrong-worker", leg)).rejects.toThrow("authority unavailable");
  await expect(db.admitPrivateCreatorSubmission(value.id, merchants.publicResearchPayee, claim.workerId, leg)).rejects.toThrow("authority unavailable");
  for (const patch of [{ amountMicros: "0" }, { amountMicros: "1.5" }, { network: "eip155:1" }, { asset: merchants.privatePayee }, { signature: "must-not-persist" }]) {
    await expect(db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, { ...leg, submission: { ...leg.submission, ...patch } } as PrivateCreatorSubmission)).rejects.toThrow("Invalid private creator submission");
  }
  await db.savePrivateResearchResult(value.id, account.address, claim.workerId, syntheticResult(value.id));
  expect(await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId, leg)).toBe(false);
  expect(await db.listPrivateCreatorSubmissions(value.id, account.address)).toEqual([]);
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
});

it("gates the actual server transport on durable creator admission and blocks a fresh nonce retry of an ambiguous leg", async () => {
  const { value, claim } = await creatorFixture();
  const leg = creatorSubmission("8", "transport-source");
  for (const nonce of [leg.submission.authorizationId, `0x${"9".repeat(64)}`]) {
    const quote = { ...requirement, amount: "20000", payTo: leg.submission.payee, maxTimeoutSeconds: config.maxTimeoutSeconds };
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 402, headers: {
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [quote] })).toString("base64"),
    } })).mockImplementationOnce(async () => {
      const persisted = await db.listPrivateCreatorSubmissions(value.id, account.address);
      expect(persisted).toHaveLength(1);
      expect(persisted[0].data.submission.authorizationId).toBe(leg.submission.authorizationId);
      throw new Error("Synthetic paid response lost");
    });
    const signer = { createPaymentPayload: async () => ({ x402Version: 2, payload: {
      authorization: { from: leg.submission.payer, to: leg.submission.payee, value: "20000", nonce, validBefore: "2000000000" }, signature: "synthetic-unfunded-signature",
    } }) };
    const pending = payWithServerSigner({ url: "https://synthetic.example/paid", method: "POST", expectedPayee: leg.submission.payee,
      expectedAmount: 0.02, payer: leg.submission.payer, signer, fetchImpl, beforeSubmit: async submission => {
        if (!await db.admitPrivateCreatorSubmission(value.id, account.address, claim.workerId,
          { ...leg, submission: submission as PrivateCreatorSubmission["submission"] })) throw new Error("Creator leg not admitted");
      } });
    if (nonce === leg.submission.authorizationId) {
      expect(await pending).toMatchObject({ settlementStatus: "pending", authorizationId: nonce });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } else {
      await expect(pending).rejects.toThrow("Creator leg not admitted");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  }
});

it("requires exact Supabase admission readback and never treats RPC acknowledgement alone as payment permission", async () => {
  const workerId = "00000000-0000-4000-8000-000000000001", date = "2026-09-09T00:00:00.000Z";
  const leg = creatorSubmission("7", "source-seven");
  for (const outcome of ["admitted", "denied", "missing", "corrupt", "outage"] as const) {
    let stored: Record<string, unknown> = {};
    const http = vi.fn<typeof fetch>(async (url, options) => {
      const route = new URL(String(url)).pathname;
      if (route.endsWith("/private_research_intents")) return Response.json([{ data: intent }]);
      if (route.endsWith("/private_research_payment_attempts")) return Response.json([{ started_at: date, confirmation, settled_at: date }]);
      if (route.endsWith("/private_research_executions")) return Response.json([{ worker_id: workerId, started_at: date }]);
      if (route.endsWith("/rpc/admit_private_creator_submission")) {
        const body = JSON.parse(String(options?.body));
        expect(body).toMatchObject({ p_id: intent.id, p_payer: account.address.toLowerCase(), p_worker_id: workerId, p_amount_micros: 20000 });
        stored = { leg_id: body.p_leg_id, worker_id: workerId, authorization_id: body.p_authorization_id, amount_micros: body.p_amount_micros, data: body.p_data, started_at: date };
        return Response.json(outcome !== "denied");
      }
      if (route.endsWith("/private_creator_submissions")) {
        expect(new URL(String(url)).searchParams.get("job_id")).toBe(`eq.${intent.id}`);
        if (outcome === "outage") return new Response("{}", { status: 503 });
        return Response.json(outcome === "missing" ? [] : [outcome === "corrupt" ? { ...stored, amount_micros: 1 } : stored]);
      }
      throw new Error("Unexpected synthetic request");
    });
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    const pending = admitSupabasePrivateCreatorSubmission(client, intent.id, account.address, workerId, leg);
    if (outcome === "admitted" || outcome === "denied") expect(await pending).toBe(outcome === "admitted");
    else await expect(pending).rejects.toThrow();
    expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/"))).toHaveLength(1);
  }
});

it("saves the first private result for its exact worker and owner, preserving retries and restart recovery", async () => {
  const { value, proof } = await executionFixture();
  const run = syntheticResult(value.id);
  expect(await db.getPrivateResearchResult(value.id, account.address)).toBeNull();
  await expect(db.savePrivateResearchResult(value.id, account.address, "missing-worker", run)).rejects.toThrow("authority unavailable");
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  const claim = (await db.claimPrivateResearchExecution(value.id, account.address))!;
  await expect(db.savePrivateResearchResult(value.id, merchants.privatePayee, claim.workerId, run)).rejects.toThrow("authority unavailable");
  await expect(db.savePrivateResearchResult(value.id, account.address, "wrong-worker", run)).rejects.toThrow("authority unavailable");
  for (const changed of [{ ...run, id: intent.id }, { ...run, question: "Different" }, { ...run, budget: 0.04 }, { ...run, researchMode: "deep" as const }]) {
    await expect(db.savePrivateResearchResult(value.id, account.address, claim.workerId, changed)).rejects.toThrow("result mismatch");
  }
  const replies = await Promise.all([db.savePrivateResearchResult(value.id, account.address, claim.workerId, run), other.savePrivateResearchResult(value.id, account.address, claim.workerId, run)]);
  expect(replies[0]).toEqual(replies[1]);
  expect(replies[0]).toMatchObject({ id: value.id, format: "query-run-v1", serializedRun: JSON.stringify(run) });
  await expect(other.savePrivateResearchResult(value.id, account.address, claim.workerId, { ...run, answer: "Replacement" })).rejects.toThrow("result conflict");
  expect(await db.getPrivateResearchResult(value.id, merchants.privatePayee)).toBeNull();
  const reopened = new SqliteAdapter(file);
  try {
    await reopened.init();
    expect(await reopened.getPrivateResearchResult(value.id, account.address)).toEqual(replies[0]);
    expect(await reopened.claimPrivateResearchExecution(value.id, account.address)).toBeNull();
  } finally { reopened.close(); }
  expect(await db.getQueryRun(value.id)).toBeNull();
  expect(await db.getA2aOrder(value.id)).toBeNull();
  for (const table of ["query_runs", "a2a_orders", "payment_events"]) expect(raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
});

it("snapshots results before asynchronous lookups and refuses corrupt readbacks", async () => {
  const { value, proof } = await executionFixture();
  await db.claimPrivatePaymentSubmission(value.id, account.address);
  await db.confirmPrivatePayment(value.id, account.address, proof);
  const claim = (await db.claimPrivateResearchExecution(value.id, account.address))!;
  const run = syntheticResult(value.id);
  const save = db.savePrivateResearchResult(value.id, account.address, claim.workerId, run);
  run.question = "Mutated while verifying";
  expect(JSON.parse((await save).serializedRun).question).toBe(request.question);
  for (const corrupt of ["not-json", JSON.stringify({ ...syntheticResult(value.id), question: "Wrong identity" })]) {
    raw.prepare("UPDATE private_research_results SET serialized_run=? WHERE id=?").run(corrupt, value.id);
    await expect(db.getPrivateResearchResult(value.id, account.address)).rejects.toThrow("result mismatch");
  }
});

it("Supabase result persistence binds owner and worker and requires the exact original readback", async () => {
  const workerId = "00000000-0000-4000-8000-000000000001";
  const run = syntheticResult(intent.id);
  const date = "2026-09-09T00:00:00.000Z";
  for (const outcome of ["saved", "missing", "conflict", "outage"] as const) {
    const http = vi.fn<typeof fetch>(async (url, options) => {
      const route = new URL(String(url)).pathname;
      if (route.endsWith("/private_research_intents")) return Response.json([{ data: intent }]);
      if (route.endsWith("/private_research_payment_attempts")) return Response.json([{ started_at: date, confirmation, settled_at: date }]);
      if (route.endsWith("/private_research_executions")) return Response.json([{ worker_id: workerId, started_at: date }]);
      if (route.endsWith("/rpc/save_private_research_result")) {
        expect(JSON.parse(String(options?.body))).toEqual({ p_id: intent.id, p_payer: account.address.toLowerCase(), p_worker_id: workerId, p_serialized_run: JSON.stringify(run) });
        return new Response(null, { status: 204 });
      }
      if (route.endsWith("/private_research_results")) {
        expect(new URL(String(url)).searchParams.get("id")).toBe(`eq.${intent.id}`);
        if (outcome === "outage") return new Response("{}", { status: 503 });
        return Response.json(outcome === "missing" ? [] : [{ serialized_run: JSON.stringify(outcome === "conflict" ? { ...run, answer: "Conflicting original" } : run), saved_at: date }]);
      }
      throw new Error("Unexpected synthetic request");
    });
    const client = createClient("https://synthetic-private-storage.example", "no-authority", { global: { fetch: http }, auth: { persistSession: false } });
    const result = saveSupabasePrivateResult(client, intent.id, account.address, workerId, run);
    if (outcome === "saved") expect(await result).toEqual({ id: intent.id, format: "query-run-v1", serializedRun: JSON.stringify(run), savedAt: date });
    else await expect(result).rejects.toThrow();
    expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/"))).toHaveLength(1);
  }
});
