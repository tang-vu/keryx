import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { releaseSupabasePrivateTreasury } from "./private-treasury-release";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { SqliteAdapter } from "./sqlite-adapter";
import type { PrivateCreatorSubmission } from "./private-creator-submissions";
import type { QueryRun } from "../types";
import { createPrivateReconciliation } from "../a2a/private-reconciliation";

// Ephemeral, unfunded keys; no provider, signing service or network requests.
const owner = privateKeyToAccount(generatePrivateKey());
const merchants = { privatePayee: `0x${"ab".repeat(20)}`, publicResearchPayee: `0x${"cd".repeat(20)}` };
const treasury = { signer: `0x${"ef".repeat(20)}`, capacityMicros: "50000" };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000", payTo: merchants.privatePayee,
  maxTimeoutSeconds: 604860, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
let dir: string, file: string, db: SqliteAdapter, other: SqliteAdapter, raw: DatabaseSync;
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-release-")); file = path.join(dir, "test.sqlite");
  db = new SqliteAdapter(file); other = new SqliteAdapter(file); await db.init(); await other.init(); raw = new DatabaseSync(file);
});
beforeEach(() => { treasury.signer = privateKeyToAccount(generatePrivateKey()).address.toLowerCase(); });
afterAll(() => { db.close(); other.close(); raw.close(); fs.rmSync(dir, { recursive: true }); });
async function fixture() {
  const request = { question: "Synthetic treasury release fixture", budget: 0.03, researchMode: "quick", packageVersion: "1.0.0",
    responseMode: "async", access: "payer-private-v1", model: null };
  const draft = await createPrivateAuthorization(request, requirement, owner.address, merchants, 1788912000000);
  const signature = await owner.signTypedData(buyerTypedData(draft.authorization));
  const intent = await preparePrivateResearchIntent({ request: draft.request, salt: draft.salt,
    payment: { authorization: draft.authorization, signature } }, requirement, merchants);
  await db.reservePrivateResearchIntent(intent);
  await db.claimPrivatePaymentSubmission(intent.id, owner.address);
  await db.confirmPrivatePayment(intent.id, owner.address, { source: "circle-facilitator-success", transaction: "synthetic-incoming",
    network: BUYER_NETWORK, payer: owner.address, payee: merchants.privatePayee, amountMicros: "50000", authorizationId: draft.authorization.nonce });
  const claim = (await db.claimPrivateResearchExecution(intent.id, owner.address))!;
  const run: QueryRun = { id: intent.id, question: request.question, budget: 0.03, researchMode: "quick", engine: "heuristic",
    subClaims: [], decisions: [], citations: [], answer: "Synthetic sealed answer", totalSpent: 0, totalToCreators: 0,
    trace: [], createdAt: "2026-09-10T00:00:00.000Z", paymentMode: "offline" };
  return { id: intent.id, worker: claim.workerId, run };
}
function leg(digit: string, amountMicros = "17000"): PrivateCreatorSubmission {
  return { kind: "citation", sourceId: `synthetic-${digit}`, itemId: null, submission: {
    authorizationId: `0x${digit.repeat(64)}`, authorizationExpiresAt: "2020-01-01T00:00:00.000Z",
    payer: treasury.signer, payee: merchants.publicResearchPayee, amountMicros, network: BUYER_NETWORK, asset: BUYER_USDC } };
}
const release = (job: { id: string }, adapter = db) => adapter.releasePrivateTreasury(job.id, owner.address, treasury.signer);

it("requires a sealed owned result, keeps expired uncertain spend, releases once and preserves replay barriers after reopen", async () => {
  const job = await fixture(), submission = leg("1");
  await db.reservePrivateTreasury(job.id, owner.address, treasury);
  await db.admitPrivateCreatorSubmission(job.id, owner.address, job.worker, submission);
  expect(await release(job)).toBeNull();
  await db.savePrivateResearchResult(job.id, owner.address, job.worker, job.run);
  expect(await db.releasePrivateTreasury(job.id, merchants.privatePayee, treasury.signer)).toBeNull();
  await expect(db.releasePrivateTreasury(job.id, owner.address, merchants.privatePayee)).rejects.toThrow("authority");
  const results = await Promise.all([release(job), release(job, other)]);
  expect(results.map(row => row?.newlyReleased).sort()).toEqual([false, true]);
  expect(results.every(row => row?.amountMicros === "13000")).toBe(true);
  expect(await db.getPrivateTreasurySummary(treasury.signer)).toMatchObject({ allocatedMicros: "17000", unallocatedMicros: "33000",
    committedMicros: "17000", unresolvedOrProcessingMicros: "17000", conservativeBackingMicros: "50000" });
  const reopened = new SqliteAdapter(file); await reopened.init();
  try {
    expect(await release(job, reopened)).toEqual({ amountMicros: "13000", newlyReleased: false });
    expect(await reopened.reservePrivateTreasury(job.id, owner.address, treasury)).toBe(true);
    expect(await reopened.admitPrivateCreatorSubmission(job.id, owner.address, job.worker, leg("2", "1"))).toBe(false);
    expect(await reopened.claimPrivateResearchExecution(job.id, owner.address)).toBeNull();
    expect(await reopened.getPrivateTreasury(job.id, owner.address)).toEqual({ signer: treasury.signer, amountMicros: "30000" });
  } finally { reopened.close(); }
  expect(() => raw.exec("UPDATE private_treasury_releases SET amount_micros=30000")).toThrow("immutable");
});

it("admits only one new reservation into returned capacity and never recycles confirmed creator spend", async () => {
  const job = await fixture(), a = await fixture(), b = await fixture(), submission = leg("3");
  await db.reservePrivateTreasury(job.id, owner.address, treasury);
  await db.admitPrivateCreatorSubmission(job.id, owner.address, job.worker, submission);
  await db.confirmPrivateCreatorSubmission(job.id, owner.address, job.worker,
    { source: "circle-facilitator-success", transaction: "synthetic-creator", submission: submission.submission });
  expect(await db.reservePrivateTreasury(a.id, owner.address, treasury)).toBe(false);
  await db.savePrivateResearchResult(job.id, owner.address, job.worker, job.run);
  await release(job);
  expect((await Promise.all([db.reservePrivateTreasury(a.id, owner.address, treasury),
    other.reservePrivateTreasury(b.id, owner.address, treasury)])).sort()).toEqual([false, true]);
  expect(await db.getPrivateTreasurySummary(treasury.signer)).toMatchObject({ allocatedMicros: "47000", unallocatedMicros: "3000",
    confirmedMicros: "17000", conservativeBackingMicros: "33000" });
});

it("recovers a saved zero-spend job through the real coordinator without payment calls or repeated release", async () => {
  const job = await fixture(); await db.reservePrivateTreasury(job.id, owner.address, treasury);
  await db.savePrivateResearchResult(job.id, owner.address, job.worker, job.run);
  const coordinator = createPrivateReconciliation(db, treasury.signer, { search: async () => { throw new Error("Network forbidden"); } });
  expect(await coordinator.tick()).toMatchObject({ allocationsReleased: 1, errors: 0 });
  await coordinator.tick();
  expect(await coordinator.tick()).toMatchObject({ allocationsReleased: 0, errors: 0 });
  expect(await db.getPrivateTreasurySummary(treasury.signer)).toMatchObject({ allocatedMicros: "0", unallocatedMicros: "50000" });
});

it("cannot release a full-budget job and refuses inconsistent ledger signers", async () => {
  const job = await fixture(); await db.reservePrivateTreasury(job.id, owner.address, treasury);
  await db.admitPrivateCreatorSubmission(job.id, owner.address, job.worker, leg("4", "30000"));
  await db.savePrivateResearchResult(job.id, owner.address, job.worker, job.run);
  expect(await release(job)).toEqual({ amountMicros: "0", newlyReleased: true });
  const wrong = await fixture(); await db.reservePrivateTreasury(wrong.id, owner.address, { ...treasury, signer: merchants.privatePayee });
  await db.admitPrivateCreatorSubmission(wrong.id, owner.address, wrong.worker, leg("5", "1"));
  await db.savePrivateResearchResult(wrong.id, owner.address, wrong.worker, wrong.run);
  await expect(db.releasePrivateTreasury(wrong.id, owner.address, merchants.privatePayee)).rejects.toThrow("accounting mismatch");
});

it("requires exact Supabase readback and recovers an RPC response loss without a second allocation release", async () => {
  const job = await fixture(); await db.reservePrivateTreasury(job.id, owner.address, treasury);
  await db.savePrivateResearchResult(job.id, owner.address, job.worker, job.run);
  let loseResponse = true, corruptReadback = false, rpcCalls = 0;
  const allowed = new Set(["private_research_intents", "private_research_payment_attempts", "private_research_executions",
    "private_research_results", "private_treasury_reservations", "private_creator_submissions", "private_treasury_releases"]);
  const client = createClient("https://synthetic.invalid", "no-authority", { auth: { persistSession: false }, global: { fetch: async (url, options) => {
    const route = new URL(String(url)), table = route.pathname.split("/").at(-1)!;
    if (route.pathname.endsWith("/rpc/release_private_treasury")) {
      rpcCalls++;
      expect(JSON.parse(String(options?.body))).toEqual({ p_id: job.id, p_payer: owner.address.toLowerCase(), p_signer: treasury.signer });
      const result = await release(job);
      if (loseResponse) { loseResponse = false; return new Response("{}", { status: 503 }); }
      return Response.json(result?.newlyReleased);
    }
    if (!allowed.has(table) || options?.method !== "GET") throw new Error("Unexpected transport");
    const column = ["private_treasury_reservations", "private_creator_submissions", "private_treasury_releases"].includes(table) ? "job_id" : "id";
    const rows = raw.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).all(job.id).map(row => {
      const parsed = { ...row };
      for (const key of ["data", "confirmation"]) if (typeof parsed[key] === "string") parsed[key] = JSON.parse(parsed[key]);
      if (table === "private_treasury_releases" && corruptReadback) parsed.amount_micros = 29999;
      return parsed;
    });
    return Response.json(rows);
  } } });
  await expect(releaseSupabasePrivateTreasury(client, job.id, owner.address, treasury.signer)).rejects.toThrow("unavailable");
  expect(await releaseSupabasePrivateTreasury(client, job.id, owner.address, treasury.signer)).toEqual({ amountMicros: "30000", newlyReleased: false });
  corruptReadback = true;
  await expect(releaseSupabasePrivateTreasury(client, job.id, owner.address, treasury.signer)).rejects.toThrow("accounting mismatch");
  expect(rpcCalls).toBe(3);
  expect(raw.prepare("SELECT COUNT(*) AS n FROM private_treasury_releases WHERE job_id=?").get(job.id)?.n).toBe(1);
});
