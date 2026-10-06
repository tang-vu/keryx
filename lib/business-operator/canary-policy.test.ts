import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { a2aOrderId, type A2aOrder } from "../a2a/order";
import { a2aResearchPackageForVersion } from "../a2a/research-package";
import type { BuyerIntent } from "../buyer/journal";
import type { KeryxDB } from "../db/keryx-db";
import type { PaymentRecord, QueryRun } from "../types";
import { OpenAICompatibleEngine } from "../llm/openai-compatible-engine";
import { AnthropicEngine } from "../llm/anthropic-engine";
import {
  activateBusinessCanary, admitBusinessCanaryRun, assertCanaryCreatorPayment, assertPreparedCanarySubmission,
  bindBusinessCanaryAdmission, businessCanaryHostIdentity, canaryOriginalClaim, closeVerifiedBusinessCanary,
  configuredBusinessCanary, reserveCanaryInboundSettlement, reserveCanaryModel, reserveCanarySearch, type BusinessCanaryPolicy,
  closeVerifiedFailedBusinessCanary, verifyFailedBusinessCanary, retainedBusinessCanaryClosure, canaryExecutionPaused,
  assertOrdinaryCanarySupplierAdmission,
} from "./canary-policy";
import { businessCanaryPaidAdmission } from "./canary-paid-admission";

const now = "2026-10-06T12:00:00.000Z", expiresAt = "2026-10-07T00:00:00.000Z";
const fixtureParent = os.homedir(), roots: string[] = [];
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
// Only directory synchronization is substituted on Windows; retained file writes/fsync are real.
// Linux uses production fsync, under the fixture owner's non-shared home rather than /tmp.
const flush = process.platform === "win32" ? () => {} : undefined;
function syncFixtureDirectory(directory: string) {
  if (process.platform === "win32") return;
  const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function isolatedEnvironment(root: string): NodeJS.ProcessEnv {
  // No provider credentials or production env files are inherited. The policy envelope is
  // explicitly mainnet; unrelated runtime imports use the offline testnet profile.
  return { NODE_ENV: "test", HOME: root, USERPROFILE: root, SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
    KERYX_NETWORK: "arcTestnet", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet", KERYX_FORCE_OFFLINE: "1" };
}
function childCommand(args: string[], env: NodeJS.ProcessEnv) {
  return new Promise<{ status: number | null; output: string; error: string }>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"], env });
    let output = "", error = "";
    const timer = setTimeout(() => { child.kill(); reject(Error("Canary fixture child exceeded deadline")); }, 20000);
    child.stdout.on("data", bytes => { output = (output + bytes).slice(0, 4096); });
    child.stderr.on("data", bytes => { error = (error + bytes).slice(-4096); });
    child.on("error", cause => { clearTimeout(timer); reject(cause); });
    child.on("exit", status => { clearTimeout(timer); resolve({ status, output, error }); });
  });
}
class OrdinaryCompatible extends OpenAICompatibleEngine {
  constructor() { super({ provider: "deepseek", name: "llm:deepseek:deepseek-v4-flash", model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com", apiKey: "synthetic-fixture-key" }); }
  request() { return this.chatJson("deepseek-v4-flash", "Fixture policy", "Fixture data", 1); }
}
class OrdinaryAnthropic extends AnthropicEngine {
  request() { return this.chatJson("fixture-anthropic-model", "Fixture policy", "Fixture data", 1); }
}
function ordinaryTransports() {
  const sdkCreate = vi.spyOn(Anthropic.Messages.prototype, "create").mockImplementation(() => {
    throw Error("SDK dispatch must not occur in an ordinary canary transport test");
  });
  return { engines: [new OrdinaryCompatible(), new OrdinaryAnthropic()], sdkCreate };
}

function original(): BuyerIntent {
  const from = `0x${"1".repeat(40)}`, to = `0x${"2".repeat(40)}`, nonce = `0x${"a".repeat(64)}`;
  return { schema: "keryx-buyer-intent-v1",
    request: { question: "Which supplier bounds apply to this single research original?", budget: 0.01,
      researchMode: "quick", packageVersion: "1.0.0", responseMode: "async" },
    requirement: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      amount: "30000", payTo: to, maxTimeoutSeconds: 691200,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    authorization: { from, to, value: "30000", nonce, validAfter: "1791248400", validBefore: "1791936000" },
    queryId: a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId, payer: from, payee: to, authorizationId: nonce }) };
}
function newRoot() {
  const root = fs.mkdtempSync(path.join(fixtureParent, "keryx-canary-policy-test-"));
  roots.push(root); fs.chmodSync(root, 0o700); return root;
}
function fixture(reserveOriginal = true, reserveInbound = reserveOriginal) {
  const root = newRoot(); vi.spyOn(os, "homedir").mockReturnValue(root);
  const directory = path.join(root, ".local", "share", "keryx-business-canary");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); fs.chmodSync(directory, 0o700);
  const policy: BusinessCanaryPolicy = { format: "keryx-business-canary-v1", approvalId: "operator-business-20261006",
    approvedAt: "2026-10-06T03:23:02.644Z", expiresAt, priceCheckedOn: "2026-10-06", maximumOriginals: 1,
    maximumMicroUsd: 250000, maximumMicroUsdc: 60000, creatorPaymentMode: "forbidden",
    executionHostSha256: businessCanaryHostIdentity(), original: original() };
  const file = path.join(root, "policy.json"), bytes = JSON.stringify(policy), digest = sha(bytes);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  activateBusinessCanary(file, digest, flush);
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", file); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", digest);
  if (reserveOriginal) assertPreparedCanarySubmission(policy.original, flush);
  if (reserveInbound) reserveCanaryInboundSettlement(flush);
  return { root, directory, policy, file, digest };
}
type Fixture = ReturnType<typeof fixture>;
function runInput(value: Fixture) {
  return { queryId: value.policy.original.queryId, question: value.policy.original.request.question,
    budget: 0.01, origin: "a2a", researchMode: "quick", fundingOwner: "treasury", privateScope: false };
}
async function admitted<T>(value: Fixture, action: () => T | Promise<T>, directoryFlush: ((directory: string) => void) | undefined = flush) {
  const token = admitBusinessCanaryRun(runInput(value), directoryFlush)!;
  const run = bindBusinessCanaryAdmission(token, (async function* () { yield await action(); })());
  try { return (await run.next()).value as T; } finally { await run.return(); }
}
const holds = (value: Fixture) => fs.readdirSync(value.directory).filter(name => /^(model|search)-/.test(name)).sort();
const write = (value: Fixture, name: string, bytes: string) => fs.writeFileSync(path.join(value.directory, name), bytes, { mode: 0o600 });
function removeSelectors() {
  vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", undefined); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
}
function terminal(value: Fixture) {
  const binding = canaryOriginalClaim()!;
  const order: A2aOrder = { id: binding.id, queryId: binding.queryId, authorizationId: binding.authorizationId,
    requestHash: binding.requestHash, payer: binding.payer, payee: binding.payee, amountUsdc: 0.03,
    creatorBudgetUsdc: 0.01, serviceFeeUsdc: 0.02, researchMode: "quick", researchPackage: a2aResearchPackageForVersion("quick", "1.0.0")!,
    status: "completed", transaction: "synthetic-fixture-inbound-proof", request: { question: value.policy.original.request.question,
      origin: "a2a", network: ARC_MAINNET_PROFILE.networkId }, startedAt: "2026-10-06T11:59:59.000Z", workerId: "fixture-worker",
    executionJournalVersion: 1, paymentStartedAt: null, resultSavingAt: now, response: {}, errorCode: null,
    resolution: null, createdAt: "2026-10-06T11:59:58.000Z", updatedAt: now };
  const run: QueryRun = { id: binding.queryId, question: value.policy.original.request.question, budget: 0.01,
    researchMode: "quick", origin: "a2a", fundingOwner: "treasury", paymentMode: "real", engine: "fixture-engine",
    answer: "Fixture answer; no live research or settlement was performed.", subClaims: [], decisions: [], citations: [],
    evidence: [], claimCoverage: [], trace: [], totalSpent: 0, totalToCreators: 0, pendingSpendUsdc: 0, createdAt: now };
  // Native exact-original settlement is tested in the DB suite. This unit fixture controls that
  // proof result, while using the real saved-response/accounting verifier during closure.
  const db = { getA2aOrder: vi.fn(async () => order), getQueryRun: vi.fn(async () => run),
    hasA2aOriginalSettlement: vi.fn(async () => true), listCreatorPaymentAttemptsByQuery: vi.fn(async (): Promise<PaymentRecord[]> => []) };
  return { db, run, order, binding, close: () => closeVerifiedBusinessCanary(db as unknown as KeryxDB, flush) };
}
function failedTerminal(value: Fixture) {
  const proof = terminal(value);
  Object.assign(proof.order, { status: "failed", errorCode: "research_failed", response: null, resultSavingAt: null });
  proof.db.getQueryRun.mockResolvedValue(null as unknown as QueryRun);
  return { ...proof, verify: () => verifyFailedBusinessCanary(proof.db),
    close: () => closeVerifiedFailedBusinessCanary(proof.db, flush) };
}
async function failedHolds(value: Fixture) {
  await admitted(value, () => { reserveCanaryModel("fixture policy", "fixture data", 2048);
    reserveCanarySearch("first fixture query"); reserveCanarySearch("second fixture query"); });
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now); removeSelectors();
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Network is forbidden in retained-ledger fixtures"); }));
});

describe("verified failed canary lifecycle closure preserves paid delivery", () => {
  it("verifies readonly exact native evidence and commits every raw retained hold without changing the failed row", async () => {
    const value = fixture(), failed = failedTerminal(value); await failedHolds(value);
    const row = structuredClone(failed.order), before = fs.readdirSync(value.directory).sort().map(name =>
      ({ name, bytes: fs.readFileSync(path.join(value.directory, name), "utf8") }));
    const proof = await failed.verify();
    expect(proof).toMatchObject({ outcome: "verified-failed-original", paidDeliveryObligation: "unresolved", admissionPaused: true,
      deliveryCompleted: false, refunded: false, providerLedger: { modelCalls: 1, searchCalls: 2, reservedMicroUsd: 36660 } });
    expect(proof.providerLedger.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(failed.db.hasA2aOriginalSettlement).toHaveBeenCalledWith(failed.binding);
    expect(failed.order).toEqual(row); expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
    expect(fs.readdirSync(value.directory).sort().map(name => ({ name, bytes: fs.readFileSync(path.join(value.directory, name), "utf8") }))).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("closes after expiry while retaining the failure, all holds and a persistent admission pause after selectors are removed", async () => {
    const value = fixture(), failed = failedTerminal(value); await failedHolds(value);
    const row = structuredClone(failed.order), names = holds(value), bytes = names.map(name => fs.readFileSync(path.join(value.directory, name), "utf8"));
    vi.setSystemTime("2026-10-08T12:00:00.000Z"); const proof = await failed.close();
    expect(JSON.parse(fs.readFileSync(path.join(value.directory, "closed.json"), "utf8"))).toMatchObject({ ...proof,
      format: "keryx-business-canary-closed-v1", policySha256: value.digest, queryId: value.policy.original.queryId });
    expect(() => configuredBusinessCanary()).toThrow("Business canary"); removeSelectors();
    expect(configuredBusinessCanary()).toBeNull(); expect(retainedBusinessCanaryClosure()).toEqual(proof);
    expect(canaryExecutionPaused()).toBe(true); expect(canaryOriginalClaim()).toBeUndefined();
    expect(() => assertOrdinaryCanarySupplierAdmission()).toThrow("ordinary supplier transport is held");
    for (const action of [() => reserveCanaryModel("policy", "new model", 1), () => reserveCanarySearch("new search"),
      () => assertPreparedCanarySubmission(value.policy.original, flush), () => reserveCanaryInboundSettlement(flush),
      () => admitBusinessCanaryRun(runInput(value), flush), () => assertCanaryCreatorPayment()]) expect(action).toThrow("Business canary");
    expect(businessCanaryPaidAdmission({ body: value.policy.original.request, signatureHeader: null, network: ARC_MAINNET_PROFILE.networkId,
      payee: value.policy.original.requirement.payTo, amountMicroUsdc: "30000", creatorBudgetMicroUsdc: "10000", bot: false })?.status).toBe(503);
    vi.setSystemTime(now); expect(() => activateBusinessCanary(value.file, value.digest, flush)).toThrow("already closed");
    await expect(failed.close()).rejects.toThrow("already closed");
    expect(failed.order).toEqual(row); expect(holds(value)).toEqual(names);
    expect(names.map(name => fs.readFileSync(path.join(value.directory, name), "utf8"))).toEqual(bytes); expect(fetch).not.toHaveBeenCalled();
  });

  it.each([{ status: "running" }, { status: "completed" }, { errorCode: "invalid_order_data" }, { executionJournalVersion: 0 },
    { startedAt: null }, { workerId: null }, { paymentStartedAt: now }, { resultSavingAt: now }, { response: {} },
    { id: "foreign-original" }, { payer: `0x${"3".repeat(40)}` }, { amountUsdc: 0.04 }, { transaction: "" },
    { requestHash: "b".repeat(64) }, { researchMode: "deep" }, { resolution: {} }] as Partial<A2aOrder>[])
    ("refuses wrong or uncertain original execution evidence %j", async change => {
      const value = fixture(), failed = failedTerminal(value); Object.assign(failed.order, change);
      await expect(failed.close()).rejects.toThrow(); expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
    });

  it.each(["settlement false", "settlement missing", "settlement error", "saved run", "creator attempt", "unknown run"] as const)
    ("refuses %s without a closure write", async kind => {
      const value = fixture(), failed = failedTerminal(value);
      if (kind === "settlement false") failed.db.hasA2aOriginalSettlement.mockResolvedValue(false);
      if (kind === "settlement missing") Object.assign(failed.db, { hasA2aOriginalSettlement: undefined });
      if (kind === "settlement error") failed.db.hasA2aOriginalSettlement.mockRejectedValue(Error("Synthetic native uncertainty"));
      if (kind === "saved run") failed.db.getQueryRun.mockResolvedValue(failed.run);
      if (kind === "unknown run") failed.db.getQueryRun.mockResolvedValue(undefined as unknown as QueryRun);
      if (kind === "creator attempt") failed.db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([{} as PaymentRecord]);
      await expect(failed.close()).rejects.toThrow(); expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

  it("refuses another execution origin even when the queue-neutral binding still matches", async () => {
    const value = fixture(), failed = failedTerminal(value); failed.order.request!.origin = "engine";
    await expect(failed.close()).rejects.toThrow("failed original proof incomplete");
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it.each(["empty", "malformed", "foreign", "wrong price", "extra", "gap", "missing inbound"] as const)
    ("refuses %s retained provider/original records", async kind => {
      const value = fixture(), failed = failedTerminal(value); await failedHolds(value);
      const file = path.join(value.directory, "model-01.json"), record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (kind === "empty") write(value, "model-01.json", "");
      if (kind === "malformed") write(value, "model-01.json", '{"interrupted":');
      if (kind === "foreign") write(value, "model-01.json", JSON.stringify({ ...record, policySha256: "f".repeat(64) }));
      if (kind === "wrong price") write(value, "model-01.json", JSON.stringify({ ...record, reserveMicroUsd: 1 }));
      if (kind === "extra") write(value, "unexpected.json", "{}");
      if (kind === "gap") { fs.unlinkSync(file); write(value, "model-02.json", JSON.stringify({ ...record, slot: 2 })); }
      if (kind === "missing inbound") fs.unlinkSync(path.join(value.directory, "inbound-settlement.json"));
      await expect(failed.close()).rejects.toThrow(); expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
    });

  it.each(["hold changed", "hold deleted", "hold added", "obligation forged", "native row changed", "creator appeared"] as const)
    ("fails closed on post-closure %s and never releases admission", async kind => {
      const value = fixture(), failed = failedTerminal(value); await failedHolds(value); await failed.close(); removeSelectors();
      const file = path.join(value.directory, "model-01.json"), record = JSON.parse(fs.readFileSync(file, "utf8"));
      if (kind === "hold changed") write(value, "model-01.json", JSON.stringify(record)); // Values same, committed raw bytes differ.
      if (kind === "hold deleted") fs.unlinkSync(file);
      if (kind === "hold added") write(value, "model-02.json", JSON.stringify({ ...record, slot: 2 }));
      if (kind === "obligation forged") { const marker = JSON.parse(fs.readFileSync(path.join(value.directory, "closed.json"), "utf8"));
        write(value, "closed.json", JSON.stringify({ ...marker, paidDeliveryObligation: "resolved" })); }
      if (kind === "native row changed") failed.order.errorCode = "different_failure";
      if (kind === "creator appeared") failed.db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([{} as PaymentRecord]);
      await expect(failed.verify()).rejects.toThrow(); expect(canaryExecutionPaused()).toBe(true);
      if (!kind.startsWith("native") && kind !== "creator appeared") expect(() => configuredBusinessCanary()).toThrow("Business canary");
    });

  it("refuses evidence drift across native awaits before writing a marker", async () => {
    const value = fixture(), failed = failedTerminal(value); await failedHolds(value);
    failed.db.hasA2aOriginalSettlement.mockImplementationOnce(async () => {
      const record = JSON.parse(fs.readFileSync(path.join(value.directory, "model-01.json"), "utf8"));
      write(value, "model-01.json", JSON.stringify({ ...record, inputBytes: record.inputBytes + 1 })); return true;
    });
    await expect(failed.close()).rejects.toThrow("changed during inspection"); expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it("has only one exclusive closure winner and retains interrupted fsync state", async () => {
    const value = fixture(), failed = failedTerminal(value);
    const results = await Promise.allSettled([failed.close(), failed.close()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    removeSelectors(); expect(canaryExecutionPaused()).toBe(true); expect(failed.order.status).toBe("failed");
  });

  it("never reports a successful closure when directory durability failed, and preserves the marker and admission hold", async () => {
    const value = fixture(), failed = failedTerminal(value);
    await expect(closeVerifiedFailedBusinessCanary(failed.db, () => { throw Error("Synthetic directory fsync uncertainty"); })).rejects.toThrow("fsync uncertainty");
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(true); removeSelectors();
    expect(configuredBusinessCanary()).toBeNull(); expect(canaryExecutionPaused()).toBe(true);
    await expect(failed.close()).rejects.toThrow("already closed"); expect(fetch).not.toHaveBeenCalled();
  });
});
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    const resolved = path.resolve(root);
    if (path.dirname(resolved) !== path.resolve(fixtureParent) || !path.basename(resolved).startsWith("keryx-canary-policy-test-"))
      throw Error("Unsafe canary fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

describe("retained finite canary admission", () => {
  it("requires the exact held original and an opaque execution token before any supplier reservation", async () => {
    const value = fixture(false);
    expect(() => admitBusinessCanaryRun(runInput(value), flush)).toThrow("retained record refused");
    expect(() => reserveCanaryInboundSettlement(flush)).toThrow("retained record refused");
    const foreign = structuredClone(value.policy.original); foreign.request.question = "A different purchase";
    expect(() => assertPreparedCanarySubmission(foreign, flush)).toThrow("prepared original mismatch");
    expect(fs.existsSync(path.join(value.directory, "original.json"))).toBe(false);
    assertPreparedCanarySubmission(value.policy.original, flush);
    reserveCanaryInboundSettlement(flush);
    expect(() => reserveCanaryModel("policy", "outside admission", 1)).toThrow("opaque execution admission");
    expect(() => bindBusinessCanaryAdmission({ queryId: value.policy.original.queryId }, (async function* () { yield 1; })()))
      .toThrow("invalid execution admission");
    expect(() => admitBusinessCanaryRun({ ...runInput(value), question: "A different execution" }, flush)).toThrow("not the admitted paid original");
    await admitted(value, () => reserveCanarySearch("admitted research query"));
    expect(holds(value)).toEqual(["search-01.json"]);
    expect(() => assertCanaryCreatorPayment()).toThrow("creator payment forbidden");
  });

  it("consumes the inbound attempt even when durable admission is interrupted, and cannot renew it", () => {
    const value = fixture(true, false), file = path.join(value.directory, "inbound-settlement.json");
    expect(() => reserveCanaryInboundSettlement(directory => {
      syncFixtureDirectory(directory); throw Error("Fixture interrupted after durable hold");
    })).toThrow("Fixture interrupted after durable hold");
    const retained = fs.readFileSync(file, "utf8");
    activateBusinessCanary(value.file, value.digest, flush); assertPreparedCanarySubmission(value.policy.original, flush);
    expect(() => reserveCanaryInboundSettlement(flush)).toThrow("inbound attempt already consumed");
    expect(fs.readFileSync(file, "utf8")).toBe(retained); expect(holds(value)).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["expiry", "removed selectors"] as const)("keeps the inbound hold when %s changes during durable admission", change => {
    const value = fixture(true, false), file = path.join(value.directory, "inbound-settlement.json");
    expect(() => reserveCanaryInboundSettlement(directory => {
      syncFixtureDirectory(directory);
      if (change === "expiry") vi.setSystemTime(expiresAt); else removeSelectors();
    })).toThrow("Business canary");
    const retained = fs.readFileSync(file, "utf8");
    vi.setSystemTime(now); vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", value.file); vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", value.digest);
    expect(() => reserveCanaryInboundSettlement(flush)).toThrow("inbound attempt already consumed");
    expect(fs.readFileSync(file, "utf8")).toBe(retained); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["", '{"interrupted":'])("retains an interrupted inbound attempt %j without retry or supplier admission", async bytes => {
    const value = fixture(true, false); write(value, "inbound-settlement.json", bytes);
    expect(() => reserveCanaryInboundSettlement(flush)).toThrow("inbound attempt already consumed");
    await expect(admitted(value, () => reserveCanarySearch("query"))).rejects.toThrow("Business canary");
    expect(fs.readFileSync(path.join(value.directory, "inbound-settlement.json"), "utf8")).toBe(bytes);
    expect(holds(value)).toHaveLength(0); expect(fetch).not.toHaveBeenCalled();
  });

  it("allows exactly one inbound attempt across independent processes", async () => {
    const value = fixture(true, false), moduleUrl = new URL("./canary-policy.ts", import.meta.url).href;
    const program = `const Clock=Date;globalThis.Date=class extends Clock{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return Clock.parse(${JSON.stringify(now)});}};
      const {reserveCanaryInboundSettlement}=await import(${JSON.stringify(moduleUrl)});
      try{reserveCanaryInboundSettlement(process.platform==='win32'?()=>{}:undefined);console.log('won');}
      catch(error){if(!error.message.includes('inbound attempt already consumed'))throw error;console.log('held');}`;
    const outcomes = await Promise.allSettled(Array.from({ length: 3 }, () => childCommand(
      ["--import", "tsx", "--input-type=module", "-e", program],
      { ...isolatedEnvironment(value.root), KERYX_BUSINESS_CANARY_FILE: value.file, KERYX_BUSINESS_CANARY_SHA256: value.digest },
    )));
    const answers = outcomes.map(outcome => {
      if (outcome.status === "rejected") throw outcome.reason;
      const { status, output, error } = outcome.value;
      if (status !== 0) throw Error(`Inbound fixture worker failed: ${error.match(/(?:^|\n)(?:[A-Za-z]*Error|Error)\b[^\n]*/)?.[0].trim() ?? status}`);
      return output.trim();
    });
    expect(answers.sort()).toEqual(["held", "held", "won"]);
    expect(() => reserveCanaryInboundSettlement(flush)).toThrow("inbound attempt already consumed");
    await admitted(value, () => reserveCanarySearch("query after admitted inbound attempt"));
    expect(holds(value)).toEqual(["search-01.json"]); expect(fetch).not.toHaveBeenCalled();
  }, 30000);

  it("holds exactly eleven models and two searches under one shared conservative cost ceiling", async () => {
    const value = fixture();
    await admitted(value, () => {
      for (let index = 0; index < 11; index++) reserveCanaryModel("policy", "private research", 8192);
      for (let index = 0; index < 2; index++) reserveCanarySearch("private query");
      expect(() => reserveCanaryModel("policy", "twelfth", 8192)).toThrow("provider ceiling exhausted");
      expect(() => reserveCanarySearch("third query")).toThrow("provider ceiling exhausted");
    });
    const records = holds(value).map(name => JSON.parse(fs.readFileSync(path.join(value.directory, name), "utf8")));
    expect(records).toHaveLength(13);
    expect(records.reduce((total, record) => total + record.reserveMicroUsd, 0)).toBe(243260);
    expect(records.every(record => record.policySha256 === value.digest && record.queryId === value.policy.original.queryId)).toBe(true);
    expect(JSON.stringify(records)).not.toMatch(/private research|private query/);
  });

  it("bounds full UTF-8 including the JSON instruction before holding anything and keeps the authored input intact", async () => {
    const value = fixture(), system = "S", instruction = " Respond with a single JSON object.";
    const remaining = 32000 - Buffer.byteLength(system + instruction, "utf8");
    const user = "é".repeat(Math.floor(remaining / 2)) + "a".repeat(remaining % 2);
    await admitted(value, () => {
      for (const [input, maximum] of [[user + "x", 8192], [user, 8193], ["small", 0], ["small", 1.5]] as const)
        expect(() => reserveCanaryModel(system, input, maximum)).toThrow("model input/output ceiling exceeded");
      expect(holds(value)).toHaveLength(0);
      expect(() => reserveCanarySearch("q".repeat(501))).toThrow("search query ceiling exceeded");
      reserveCanaryModel(system, user, 8192);
    });
    expect(JSON.parse(fs.readFileSync(path.join(value.directory, "model-01.json"), "utf8")))
      .toMatchObject({ inputBytes: 32000, maximumOutputTokens: 8192 });
  });

  it("shares exclusive slots across independent worker processes and cannot renew the consumed original", async () => {
    const value = fixture(), moduleUrl = new URL("./canary-policy.ts", import.meta.url).href;
    const program = `const Clock=Date;globalThis.Date=class extends Clock{constructor(...args){super(...(args.length?args:[${JSON.stringify(now)}]));}static now(){return Clock.parse(${JSON.stringify(now)});}};
      const {admitBusinessCanaryRun,bindBusinessCanaryAdmission,reserveCanaryModel}=await import(${JSON.stringify(moduleUrl)});
      const token=admitBusinessCanaryRun(${JSON.stringify(runInput(value))},process.platform==='win32'?()=>{}:undefined);
      const run=bindBusinessCanaryAdmission(token,(async function*(){let count=0;for(let i=0;i<6;i++){try{reserveCanaryModel('policy','worker input',2048);count++;}catch(error){if(!error.message.includes('provider ceiling exhausted'))throw error;}}return count;})());
      const result=await run.next();if(!result.done)throw Error('Fixture generator did not terminate');console.log(result.value);`;
    const worker = async () => {
      const { status, output, error } = await childCommand(["--import", "tsx", "--input-type=module", "-e", program], {
        ...isolatedEnvironment(value.root), KERYX_BUSINESS_CANARY_FILE: value.file, KERYX_BUSINESS_CANARY_SHA256: value.digest,
      });
      // Avoid passing a child stack to Vitest's own source-map parser.
      const reason = error.match(/(?:^|\n)(?:[A-Za-z]*Error|Error)\b[^\n]*/)?.[0].trim() ?? `exit status ${status}`;
      if (status !== 0) throw Error(`Canary fixture worker failed: ${reason}`);
      return Number(output.trim());
    };
    const outcomes = await Promise.allSettled([worker(), worker(), worker()]);
    const counts = outcomes.map(outcome => { if (outcome.status === "rejected") throw outcome.reason; return outcome.value; });
    expect(counts.reduce((total, count) => total + count, 0)).toBe(11);
    expect(holds(value)).toHaveLength(11);
    activateBusinessCanary(value.file, value.digest, flush); assertPreparedCanarySubmission(value.policy.original, flush);
    await expect(admitted(value, () => reserveCanaryModel("policy", "restart", 2048))).rejects.toThrow("provider ceiling exhausted");
    const replacement = structuredClone(value.policy); replacement.original.authorization.nonce = `0x${"b".repeat(64)}`;
    replacement.original.queryId = a2aOrderId({ network: ARC_MAINNET_PROFILE.networkId,
      payer: replacement.original.authorization.from, payee: replacement.original.authorization.to,
      authorizationId: replacement.original.authorization.nonce });
    const replacementFile = path.join(value.root, "replacement-policy.json"), bytes = JSON.stringify(replacement);
    fs.writeFileSync(replacementFile, bytes, { mode: 0o600 });
    expect(() => activateBusinessCanary(replacementFile, sha(bytes), flush)).toThrow("window already belongs to another original");
    expect(holds(value)).toHaveLength(11);
  }, 30000);

  it("counts empty and partial crash-created files as occupied forever", async () => {
    const value = fixture(); write(value, "model-01.json", ""); write(value, "model-02.json", '{"interrupted":');
    await admitted(value, () => {
      for (let index = 0; index < 9; index++) reserveCanaryModel("policy", "input", 2048);
      expect(() => reserveCanaryModel("policy", "retry", 2048)).toThrow("provider ceiling exhausted");
    });
    expect(holds(value)).toHaveLength(11);
    expect(fs.readFileSync(path.join(value.directory, "model-01.json"), "utf8")).toBe("");
    expect(fs.readFileSync(path.join(value.directory, "model-02.json"), "utf8")).toBe('{"interrupted":');
  });

  it("the actual admit CLI refuses without an active policy instead of reporting completion", async () => {
    const root = newRoot(), file = path.join(root, "prepared-intent.json");
    fs.writeFileSync(file, JSON.stringify(original()), { mode: 0o600 });
    const script = path.resolve("scripts/operator-canary.mts");
    const result = await childCommand(["--import", "tsx", script, "admit", "--intent", file], isolatedEnvironment(root));
    expect(result.status).toBe(1);
    expect(result.output).not.toContain('"completed":true');
    expect(result.error).toContain("Finite canary command refused");
    expect(fs.readdirSync(root)).toEqual(["prepared-intent.json"]);
  }, 30000);

  it.each(["partial selector", "changed bytes", "changed digest", "changed host"] as const)("refuses %s while retaining the original and holds", async failure => {
    const value = fixture(); await admitted(value, () => reserveCanaryModel("policy", "input", 1));
    if (failure === "partial selector") vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", undefined);
    if (failure === "changed bytes") fs.appendFileSync(value.file, " ");
    if (failure === "changed digest") vi.stubEnv("KERYX_BUSINESS_CANARY_SHA256", "f".repeat(64));
    if (failure === "changed host") {
      const info = os.userInfo(); vi.spyOn(os, "userInfo").mockReturnValue({ ...info, username: "a-different-execution-user" });
    }
    expect(() => configuredBusinessCanary()).toThrow("Business canary");
    expect(holds(value)).toEqual(["model-01.json"]);
    expect(fs.existsSync(path.join(value.directory, "original.json"))).toBe(true);
  });

  it("refuses a copied policy and ledger under another home", () => {
    const value = fixture(), copy = newRoot(); fs.cpSync(value.root, copy, { recursive: true });
    vi.mocked(os.homedir).mockReturnValue(copy); vi.stubEnv("KERYX_BUSINESS_CANARY_FILE", path.join(copy, "policy.json"));
    expect(() => configuredBusinessCanary()).toThrow("execution host/user binding refused");
  });

  it.each(["2026-10-06T03:23:02.643Z", expiresAt, "2026-10-08T12:00:00.000Z"])("does not renew supplier permission at %s", instant => {
    const value = fixture(); vi.setSystemTime(instant);
    expect(() => configuredBusinessCanary()).toThrow("expired or outside reviewed supplier day");
    expect(() => activateBusinessCanary(value.file, value.digest, flush)).toThrow("expired or outside reviewed supplier day");
    expect(holds(value)).toHaveLength(0);
  });

  it("retains a hold if expiry is crossed during durable admission", async () => {
    const value = fixture();
    await expect(admitted(value, () => reserveCanaryModel("policy", "input", 2048), directory => {
      syncFixtureDirectory(directory); vi.setSystemTime(expiresAt);
    }))
      .rejects.toThrow("expired or outside reviewed supplier day");
    expect(holds(value)).toEqual(["model-01.json"]);
  });

  it.each(["missing", "dangling"] as const)("removed selectors cannot hide a %s window with retained holds", async kind => {
    const value = fixture(); await admitted(value, () => reserveCanarySearch("query"));
    const window = path.join(value.directory, "window.json"); fs.unlinkSync(window);
    if (kind === "dangling") fs.symlinkSync(path.join(value.root, "nonexistent-target"), window, process.platform === "win32" ? "junction" : "file");
    removeSelectors(); expect(() => configuredBusinessCanary()).toThrow("Business canary");
    expect(holds(value)).toEqual(["search-01.json"]);
  });

  it.skipIf(process.platform === "win32")("refuses public permissions on protected files and ledger", () => {
    const value = fixture(); fs.chmodSync(value.file, 0o644);
    expect(() => configuredBusinessCanary()).toThrow("storage permissions refused");
    fs.chmodSync(value.file, 0o600); fs.chmodSync(value.directory, 0o755);
    expect(() => configuredBusinessCanary()).toThrow("storage permissions refused");
  });
});

describe("canary generator and terminal lifecycle", () => {
  it("ordinary compatible and Anthropic transports refuse before HTTP/SDK dispatch outside and inside the admitted context", async () => {
    const value = fixture(), { engines, sdkCreate } = ordinaryTransports();
    for (const engine of engines) await expect(engine.request()).rejects.toThrow("ordinary supplier transport is held");
    await admitted(value, async () => {
      for (const engine of engines) await expect(engine.request()).rejects.toThrow("ordinary supplier transport is held");
    });
    expect(sdkCreate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(holds(value)).toHaveLength(0);
  });

  it("ordinary transports inherited from a completed canary still refuse after verified closure and selector removal", async () => {
    const value = fixture(), proof = terminal(value), { engines, sdkCreate } = ordinaryTransports();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let late!: Promise<PromiseSettledResult<Record<string, unknown>>[]>;
    const token = admitBusinessCanaryRun(runInput(value), flush)!;
    const run = bindBusinessCanaryAdmission(token, (async function* () {
      late = gate.then(() => Promise.allSettled(engines.map(engine => engine.request()))); yield "ready";
    })());
    await run.next(); await run.next(); await proof.close(); removeSelectors();
    expect(configuredBusinessCanary()).toBeNull(); release();
    for (const result of await late) {
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") expect(result.reason.message).toContain("ordinary supplier transport is held");
    }
    expect(sdkCreate).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(holds(value)).toHaveLength(0);
  });

  it.each(["complete", "return", "abort"] as const)("revokes inherited supplier work when the generator ends by %s", async ending => {
    const value = fixture(), controller = new AbortController(); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); let late!: Promise<unknown>;
    const token = admitBusinessCanaryRun(runInput(value), flush)!;
    const run = bindBusinessCanaryAdmission(token, (async function* () {
      late = gate.then(() => reserveCanarySearch("late query")).catch(error => error); yield "ready";
    })(), controller.signal);
    await run.next();
    if (ending === "complete") await run.next();
    if (ending === "return") await run.return();
    if (ending === "abort") { controller.abort(); await expect(run.next()).rejects.toThrow("admission revoked"); await run.return(); }
    release(); expect(await late).toBeInstanceOf(Error); expect(holds(value)).toHaveLength(0);
    expect(() => bindBusinessCanaryAdmission(token, (async function* () { yield 1; })())).toThrow("invalid execution admission");
  });

  it("closes only from verified terminal proof after expiry and still rejects inherited work when selectors are removed", async () => {
    const value = fixture(), proof = terminal(value); let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }); let late!: Promise<unknown>;
    const token = admitBusinessCanaryRun(runInput(value), flush)!;
    const run = bindBusinessCanaryAdmission(token, (async function* () {
      late = gate.then(() => { reserveCanarySearch("post-close query"); assertCanaryCreatorPayment(); }).catch(error => error);
      yield "ready";
    })());
    await run.next(); await run.next(); vi.setSystemTime("2026-10-08T12:00:00.000Z");
    await proof.close(); expect(proof.db.hasA2aOriginalSettlement).toHaveBeenCalledWith(proof.binding);
    removeSelectors(); expect(configuredBusinessCanary()).toBeNull(); expect(canaryExecutionPaused()).toBe(false);
    release(); expect(await late).toBeInstanceOf(Error); expect(holds(value)).toHaveLength(0);
    expect(() => reserveCanarySearch("ordinary context-free query")).not.toThrow();
  });

  it.each([{ id: "foreign-run" }, { question: "foreign question" }, { budget: 0.02 }, { researchMode: "deep" },
    { origin: "web" }, { fundingOwner: "offline" }] as Partial<QueryRun>[])("does not close over a mismatched saved run: %j", async change => {
    const value = fixture(), proof = terminal(value); proof.db.getQueryRun.mockResolvedValue({ ...proof.run, ...change });
    await expect(proof.close()).rejects.toThrow("terminal settled original proof incomplete");
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it("does not close without exact inbound proof or with creator attempts, and preserves failed closure state", async () => {
    const value = fixture(), proof = terminal(value); proof.db.hasA2aOriginalSettlement.mockResolvedValue(false);
    await expect(proof.close()).rejects.toThrow("terminal settled original proof incomplete");
    proof.db.hasA2aOriginalSettlement.mockResolvedValue(true);
    proof.db.listCreatorPaymentAttemptsByQuery.mockResolvedValue([{ kind: "fetch", queryId: proof.binding.queryId,
      sourceId: "fixture-source", sourceName: "Fixture", payer: proof.binding.payee, payee: `0x${"3".repeat(40)}`,
      amountUsdc: 0.01, network: ARC_MAINNET_PROFILE.networkId, settled: false, settlementStatus: "pending", createdAt: now }]);
    await expect(proof.close()).rejects.toThrow("terminal settled original proof incomplete");
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it("does not close without the retained exact original hold even when DB terminal proof is available", async () => {
    const value = fixture(), proof = terminal(value); fs.unlinkSync(path.join(value.directory, "original.json"));
    await expect(proof.close()).rejects.toThrow("Business canary");
    expect(proof.db.hasA2aOriginalSettlement).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it.each(["missing", "empty", "malformed", "foreign original"] as const)("does not close over a %s inbound attempt marker despite DB proof", async kind => {
    const value = fixture(), proof = terminal(value), file = path.join(value.directory, "inbound-settlement.json");
    if (kind === "missing") fs.unlinkSync(file);
    else if (kind === "empty") write(value, "inbound-settlement.json", "");
    else if (kind === "malformed") write(value, "inbound-settlement.json", '{"interrupted":');
    else {
      const record = JSON.parse(fs.readFileSync(file, "utf8")); record.queryId = "foreign-original";
      write(value, "inbound-settlement.json", JSON.stringify(record));
    }
    await expect(proof.close()).rejects.toThrow("Business canary");
    expect(proof.db.hasA2aOriginalSettlement).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(value.directory, "closed.json"))).toBe(false);
  });

  it.each(["", '{"interrupted":', '{"format":"wrong-closure"}'])("never reports success over an interrupted or mismatched close marker: %j", async bytes => {
    const value = fixture(), proof = terminal(value); write(value, "closed.json", bytes);
    await expect(proof.close()).rejects.toThrow("Business canary");
    expect(fs.readFileSync(path.join(value.directory, "closed.json"), "utf8")).toBe(bytes);
    removeSelectors(); expect(() => configuredBusinessCanary()).toThrow("Business canary");
  });
});
