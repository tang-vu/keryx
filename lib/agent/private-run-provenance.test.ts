import { mkdtempSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createClient } from "@supabase/supabase-js";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { getSupabasePrivateResult, saveSupabasePrivateResult } from "../db/private-research-results";
import { createPrivateAuthorization } from "../buyer/private-request-commitment";
import { BUYER_GATEWAY, BUYER_NETWORK, BUYER_USDC, buyerTypedData } from "../buyer/protocol";
import { preparePrivateResearchIntent } from "../a2a/private-research-intent";
import { createPrivateResultSpool } from "../a2a/private-result-spool";
import { privateResultView } from "../a2a/private-result-view";
import { runPrivateResearch } from "../a2a/run-private-research";
import { privateResearchEffects } from "./private-research-effects";
import { collectRun, type RunInput } from "./index";
import type { ReasoningEngine } from "../llm/reasoning-engine";
import type { PaymentGateway } from "../payments/payment-gateway";
import type { QueryRun } from "../types";

// Isolated, unfunded originals and synthetic confirmation rows test authority/persistence.
// No facilitator, provider, signer transport or creator payment is called.
const account = privateKeyToAccount(generatePrivateKey());
const signerAddress = `0x${"ab".repeat(20)}`;
const merchants = { privatePayee: signerAddress, publicResearchPayee: `0x${"cd".repeat(20)}` };
const requirement = { scheme: "exact", network: BUYER_NETWORK, asset: BUYER_USDC, amount: "50000",
  payTo: signerAddress, maxTimeoutSeconds: 604860,
  extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: BUYER_GATEWAY } };
const request = { question: "Synthetic private provenance fixture", budget: 0.03, researchMode: "quick",
  packageVersion: "1.0.0", responseMode: "async", access: "payer-private-v1", model: null };
const packet = { version: 1, surface: "agent-to-agent", ownershipMethod: "verified-payer" } as const;
const unknown = { version: 1, surface: "unknown", ownershipMethod: "unknown" } as const;
let directory: string;
let db: SqliteAdapter;
let forbidden: Mock<() => never>;

beforeEach(async () => {
  forbidden = vi.fn(() => { throw new Error("Outbound/financial/public effect forbidden in provenance fixture"); });
  vi.stubGlobal("fetch", forbidden);
  directory = mkdtempSync(join(tmpdir(), "keryx-private-provenance-"));
  db = new SqliteAdapter(join(directory, "fixture.sqlite"));
  await db.init();
  for (const method of ["saveQueryRun", "recordPayment", "setCached", "saveQueryMemory", "recordActivationEvent"] as const)
    vi.spyOn(db, method).mockImplementation(forbidden);
});
afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  rmSync(directory, { recursive: true, force: true });
});

async function original(settled = true) {
  const fresh = await createPrivateAuthorization(request, requirement, account.address, merchants, 1788912000000);
  const signature = await account.signTypedData(buyerTypedData(fresh.authorization));
  const intent = await preparePrivateResearchIntent({ request: fresh.request, salt: fresh.salt,
    payment: { authorization: fresh.authorization, signature } }, requirement, merchants);
  await db.reservePrivateResearchIntent(intent);
  const proof = { source: "circle-facilitator-success" as const, transaction: "synthetic-unfunded-provenance",
    network: BUYER_NETWORK, payer: account.address, payee: signerAddress, amountMicros: requirement.amount,
    authorizationId: fresh.authorization.nonce };
  if (settled) {
    await db.claimPrivatePaymentSubmission(intent.id, account.address);
    await db.confirmPrivatePayment(intent.id, account.address, proof);
  }
  return { intent, proof };
}

function executor() {
  const decompose = vi.fn(async () => ["Synthetic research target"]);
  const engine: ReasoningEngine = { name: "synthetic-no-provider", decompose, decide: forbidden,
    sufficiency: forbidden, reevaluate: forbidden, synthesize: forbidden, attribute: forbidden };
  // The empty catalog ends before funding. Even a mistaken attempt must fail this fixture.
  const gateway: PaymentGateway = { mode: "real", agentAddress: () => signerAddress,
    ensureFunded: forbidden, payFetch: forbidden, payCitation: forbidden };
  const options = { signerAddress, signer: { createPaymentPayload: forbidden },
    getGatewayBalance: vi.fn(async () => BigInt(30000)), engineForModel: vi.fn(() => engine),
    gatewayFactory: vi.fn(async () => gateway) };
  return { decompose, engine, gateway, options };
}

async function publicAbsence(id: string) {
  expect(await db.getQueryRun(id)).toBeNull();
  expect(await db.getA2aOrder(id)).toBeNull();
  expect(await db.listRecentQueries(10)).toEqual([]);
  expect(await db.listQueryRunsByAsker(account.address, 10)).toEqual([]);
  const snapshot = JSON.stringify(await db.operatorPublicSnapshot(Date.now()));
  for (const privateValue of [id, request.question, account.address.toLowerCase()]) expect(snapshot).not.toContain(privateValue);
  expect(forbidden).not.toHaveBeenCalled();
}

it("finalizes the verified original payer through private effects, encrypted spool and SQLite without public delivery", async () => {
  const { intent } = await original();
  const { decompose, options } = executor();
  const spool = await createPrivateResultSpool(join(directory, "spool"), randomBytes(32).toString("hex"));
  const saved = vi.spyOn(db, "savePrivateResearchResult");
  const outcome = await runPrivateResearch(db, intent.id, account.address, { ...options, resultSpool: spool });
  expect(outcome.status).toBe("completed");
  if (outcome.status !== "completed") throw new Error("Expected controlled private completion");
  const claim = (await db.getPrivateResearchExecution(intent.id, account.address))!;
  expect(options.gatewayFactory).toHaveBeenCalledWith({ id: intent.id, owner: account.address, workerId: claim.workerId });
  expect(outcome.run.asker).toBe(intent.submission.payment.authorization.from);
  expect(outcome.run.asker).not.toBe(signerAddress);
  expect(outcome.run.provenance).toEqual(packet);
  expect(outcome.run.totalSpent).toBe(0);
  expect(outcome.run.totalToCreators).toBe(0);
  expect(outcome.run.citations).toEqual([]);
  expect(outcome.run.trace.at(-1)?.phase).toBe("done");
  expect(saved).toHaveBeenCalledWith(intent.id, account.address, claim.workerId, outcome.run);
  const retained = (await db.getPrivateResearchResult(intent.id, account.address))!;
  expect(retained.serializedRun).toBe(JSON.stringify(outcome.run));
  for (const replacement of [{ ...outcome.run, provenance: undefined }, { ...outcome.run, provenance: unknown }]) {
    await expect(db.savePrivateResearchResult(intent.id, account.address, claim.workerId, replacement)).rejects.toThrow("result conflict");
    expect(await db.getPrivateResearchResult(intent.id, account.address)).toEqual(retained);
  }
  await expect(db.savePrivateResearchResult(intent.id, signerAddress, claim.workerId, outcome.run)).rejects.toThrow("authority unavailable");
  await expect(db.savePrivateResearchResult(intent.id, account.address, "wrong-worker", outcome.run)).rejects.toThrow("authority unavailable");
  expect(await db.getPrivateResearchResult(intent.id, signerAddress)).toBeNull();
  expect(await privateResultView(db, intent.id, signerAddress)).toBeNull();
  const projection = await privateResultView(db, intent.id, account.address);
  expect(projection).toMatchObject({ status: "completed", result: { answer: outcome.run.answer } });
  for (const field of ["provenance", "asker", "trace", "workerId"]) expect(projection?.result).not.toHaveProperty(field);
  expect(JSON.stringify(projection)).not.toContain(intent.submission.payment.signature);
  const remaining = [];
  for await (const token of spool.entries()) remaining.push(token);
  expect(remaining).toEqual([]);
  const denied = await spool.save({ id: intent.id, payer: account.address,
    workerId: "00000000-0000-4000-8000-000000000000" }, outcome.run);
  await expect(spool.restore(db, denied)).rejects.toThrow("Private result restore unavailable");
  expect((await spool.read(denied)).serializedRun).toBe(retained.serializedRun);
  expect(await db.getPrivateResearchResult(intent.id, account.address)).toEqual(retained);
  expect(await runPrivateResearch(db, intent.id, account.address, options)).toEqual({ status: "stored", result: retained });
  expect(decompose).toHaveBeenCalledTimes(1);
  expect(options.getGatewayBalance).toHaveBeenCalledTimes(1);
  await publicAbsence(intent.id);
});

it.each([
  { label: "unstamped owned run", asker: account.address, provenance: undefined, expected: unknown },
  { label: "ownerless trusted surface", asker: undefined, provenance: packet,
    expected: { ...packet, ownershipMethod: "unknown" } },
  { label: "extra client field", asker: account.address,
    provenance: { ...packet, client: "desktop" }, expected: unknown },
  { label: "unrecognized surface", asker: account.address,
    provenance: { ...packet, surface: "native-client" }, expected: unknown },
  { label: "unrecognized version", asker: account.address,
    provenance: { ...packet, version: 2 }, expected: unknown },
  { label: "unestablished owner method", asker: account.address,
    provenance: { ...packet, ownershipMethod: "linked-account" }, expected: unknown },
  { label: "accessor packet", asker: account.address,
    provenance: { ...packet, get surface() { throw new Error("Untrusted provenance accessor"); } }, expected: unknown },
])("records honest closed metadata in actual job finalization: $label", async ({ asker, provenance, expected }) => {
  const { intent } = await original();
  const claim = (await db.claimPrivateResearchExecution(intent.id, account.address))!;
  const { effects } = await privateResearchEffects(db, { id: intent.id, payer: account.address, workerId: claim.workerId });
  const { engine, gateway } = executor();
  const run = await collectRun({ queryId: intent.id, question: request.question, budget: request.budget,
    researchMode: "quick", origin: "a2a", mcpClient: "claude", asker, provenance } as RunInput,
  { deps: { db, engine, gateway, effects } });
  expect(run.provenance).toEqual(expected);
  expect(Object.keys(run.provenance!)).toEqual(["version", "surface", "ownershipMethod"]);
  expect(JSON.parse((await db.getPrivateResearchResult(intent.id, account.address))!.serializedRun).provenance).toEqual(expected);
  await publicAbsence(intent.id);
});

it("denies foreign payer, unpaid original and foreign job strategy before reasoning or result persistence", async () => {
  const { intent, proof } = await original(false);
  const { decompose, options, engine, gateway } = executor();
  const save = vi.spyOn(db, "savePrivateResearchResult");
  await expect(runPrivateResearch(db, intent.id, signerAddress, options)).rejects.toThrow("intent unavailable");
  await expect(runPrivateResearch(db, intent.id, account.address, options)).rejects.toThrow("Settled private payment unavailable");
  expect(options.getGatewayBalance).not.toHaveBeenCalled();
  expect(await db.getPrivateResearchExecution(intent.id, account.address)).toBeNull();
  await db.claimPrivatePaymentSubmission(intent.id, account.address);
  await db.confirmPrivatePayment(intent.id, account.address, proof);
  const claim = (await db.claimPrivateResearchExecution(intent.id, account.address))!;
  await expect(privateResearchEffects(db, { id: intent.id, payer: account.address, workerId: "wrong-worker" })).rejects.toThrow("authority unavailable");
  const { effects } = await privateResearchEffects(db, { id: intent.id, payer: account.address, workerId: claim.workerId });
  const input = { queryId: intent.id, question: request.question, budget: request.budget, researchMode: "quick" as const };
  await expect(collectRun(input, { deps: { db, engine, gateway,
    effects: { ...effects, scope: { kind: "job", queryId: `prv_${"0".repeat(64)}` } } } })).rejects.toThrow("another job");
  await expect(collectRun(input, { deps: { db, engine, gateway,
    effects: { ...effects, scope: { kind: "public" } } } })).rejects.toThrow("explicit effects strategy");
  expect(decompose).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
  await publicAbsence(intent.id);
});

it("preserves a finalized private packet through the Supabase serializer and refuses lossy readback", async () => {
  const { intent, proof } = await original();
  const completion = await runPrivateResearch(db, intent.id, account.address, executor().options);
  if (completion.status !== "completed") throw new Error("Expected controlled private completion");
  const claim = (await db.getPrivateResearchExecution(intent.id, account.address))!;
  const date = claim.startedAt;
  for (const outcome of ["saved", "missing-packet", "replacement-packet", "foreign-worker", "foreign-payer"] as const) {
    const run = structuredClone(completion.run);
    const captured = JSON.stringify(run);
    let snapshot: string | null = null;
    const http = vi.fn<typeof fetch>(async (url, options) => {
      const parsed = new URL(String(url));
      const route = parsed.pathname;
      if (route.endsWith("/private_research_intents")) {
        expect(parsed.searchParams.get("payer")).toBe(`eq.${outcome === "foreign-payer" ? signerAddress : account.address.toLowerCase()}`);
        return Response.json(outcome === "foreign-payer" ? [] : [{ data: intent }]);
      }
      if (route.endsWith("/private_research_payment_attempts"))
        return Response.json([{ started_at: date, confirmation: proof, settled_at: date }]);
      if (route.endsWith("/private_research_executions"))
        return Response.json([{ worker_id: claim.workerId, started_at: date }]);
      if (route.endsWith("/rpc/save_private_research_result")) {
        const body = JSON.parse(String(options?.body));
        expect(body).toEqual({ p_id: intent.id, p_payer: account.address.toLowerCase(),
          p_worker_id: claim.workerId, p_serialized_run: captured });
        snapshot = body.p_serialized_run;
        return new Response(null, { status: 204 });
      }
      if (route.endsWith("/private_research_results")) {
        if (snapshot === null) throw new Error("Readback before private write");
        const copy = JSON.parse(snapshot);
        if (outcome === "missing-packet") delete copy.provenance;
        if (outcome === "replacement-packet") copy.provenance = unknown;
        return Response.json([{ serialized_run: outcome === "saved" ? snapshot : JSON.stringify(copy), saved_at: date }]);
      }
      throw new Error("Unexpected synthetic Supabase route; public writes forbidden");
    });
    const client = createClient("https://synthetic-private-provenance.example", "no-authority",
      { global: { fetch: http }, auth: { persistSession: false } });
    const pending = saveSupabasePrivateResult(client, intent.id,
      outcome === "foreign-payer" ? signerAddress : account.address,
      outcome === "foreign-worker" ? "00000000-0000-4000-8000-000000000000" : claim.workerId, run);
    run.provenance!.surface = "unknown";
    if (outcome === "saved") {
      const retained = await pending;
      expect(retained.serializedRun).toBe(captured);
      expect(JSON.parse(retained.serializedRun).provenance).toEqual(packet);
      expect(await getSupabasePrivateResult(client, intent.id, account.address)).toEqual(retained);
    } else await expect(pending).rejects.toThrow(outcome.startsWith("foreign") ? "authority unavailable" : "result conflict");
    expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/")))
      .toHaveLength(outcome.startsWith("foreign") ? 0 : 1);
    if (!outcome.startsWith("foreign")) {
      const spool = await createPrivateResultSpool(join(directory, `supabase-spool-${outcome}`), randomBytes(32).toString("hex"));
      const token = await spool.save({ id: intent.id, payer: account.address, workerId: claim.workerId }, completion.run);
      const store = { savePrivateResearchResult: (id: string, payer: string, workerId: string, restored: QueryRun) =>
        saveSupabasePrivateResult(client, id, payer, workerId, restored) };
      if (outcome === "saved") {
        expect(await spool.restore(store, token)).toEqual({ status: "restored" });
        await expect(spool.read(token)).rejects.toThrow("Private result backup unavailable");
      } else {
        await expect(spool.restore(store, token)).rejects.toThrow("Private result restore unavailable");
        expect((await spool.read(token)).serializedRun).toBe(captured);
      }
      expect(http.mock.calls.filter(([url]) => String(url).includes("/rpc/"))).toHaveLength(2);
    }
  }
  await publicAbsence(intent.id);
});
