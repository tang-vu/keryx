import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "../canonical-json";
import type { GatewayFundingLedger, GatewayFundingStep } from "../db/gateway-funding-ledger-types";
import { createGatewayFundingOrchestratorForTrustedSyntheticComposition as execute,
  createKeylessGatewayFundingOrchestratorForTrustedSyntheticComposition as recover } from "./gateway-funding-orchestrator";
import { fundingFixture, fundingProtocol, cleanupFundingFixtures, type FundingFixture } from "./gateway-funding-test-fixture";
import { createGatewayFundingExecutorForTrustedSyntheticComposition } from "./gateway-funding-executor";
import { performance } from "node:perf_hooks";

const signing = vi.hoisted(() => ({ calls: 0, accounts: 0 }));
vi.mock("viem/accounts", async importOriginal => {
  const actual = await importOriginal<typeof import("viem/accounts")>();
  return { ...actual, sign: (...args: Parameters<typeof actual.sign>) => { signing.calls++; return actual.sign(...args); },
    privateKeyToAccount: (...args: Parameters<typeof actual.privateKeyToAccount>) => { signing.accounts++; return actual.privateKeyToAccount(...args); } };
});
afterEach(async () => { await cleanupFundingFixtures(); signing.calls = 0; signing.accounts = 0; });
const STEPS = ["nativeTransfer", "usdcTransfer", "approval", "deposit"] as const;
async function originals(f: FundingFixture) { return Promise.all(STEPS.map(step => f.ledger.inspectReservation(f.operation.operationId, step))); }
const writes = (rpc: Awaited<ReturnType<typeof fundingProtocol>>) => rpc.calls.filter(c => c.method === "eth_sendRawTransaction");
const composition = (rpc: Awaited<ReturnType<typeof fundingProtocol>>) => ({origins:rpc.origins,circleEndpoint:rpc.circleEndpoint});
const options = (f: FundingFixture) => ({ ...f.options, terminalStore: f.terminalStore });

describe("immutable operator funding operation with actual SQLite, viem and native dual HTTP", () => {
  it("bounds a blocked initial backend read before discovering an existing original", async () => {
    const f = await fundingFixture(), rpc = await fundingProtocol(f);
    expect((await createGatewayFundingExecutorForTrustedSyntheticComposition(f.options, rpc.origins).executeStep(f.operation.operationId, "nativeTransfer")).status).toBe("broadcast-acknowledged");
    const snapshot = f.snapshot(), accounts = signing.accounts; let entered = false, released = false;
    const ledger = { ...f.ledger, inspectOperation: async (...args: Parameters<typeof f.ledger.inspectOperation>) => {
      entered = true; await new Promise(resolve => setTimeout(resolve, 15000)); released = true;
      return f.ledger.inspectOperation(...args);
    } } as GatewayFundingLedger;
    const start = performance.now(), answer = await execute({ ...options(f), ledger }, composition(rpc), {
      operationDeadlineMs: 300000, keylessDeadlineMs: 10000, receiptPhaseDeadlineMs: 40000,
    }).runOperation(f.operation.operationId);
    const elapsed = performance.now() - start;
    expect(entered).toBe(true); expect(released).toBe(false); expect(answer.status).toBe("reconciliation-required"); expect(answer.stage).toBe("inspection");
    expect(elapsed).toBeGreaterThanOrEqual(9500); expect(elapsed).toBeLessThan(12000);
    expect(signing.calls).toBe(1); expect(signing.accounts).toBe(accounts); expect(writes(rpc)).toHaveLength(1); expect(f.snapshot()).toEqual(snapshot);
  }, 60000);
  it("counts pre-discovery time and bounds a held post-discovery original backend read response", async () => {
    const f = await fundingFixture(); let blocked = false, released = false;
    const rpc = await fundingProtocol(f);
    expect((await createGatewayFundingExecutorForTrustedSyntheticComposition(f.options, rpc.origins).executeStep(f.operation.operationId, "nativeTransfer")).status).toBe("broadcast-acknowledged");
    const snapshot = f.snapshot(), accounts = signing.accounts;
    let inspected = false, originalReads = 0;
    const ledger = { ...f.ledger, inspectOperation: async (...args: Parameters<typeof f.ledger.inspectOperation>) => {
      if (!inspected) { inspected = true; await new Promise(resolve => setTimeout(resolve, 2000)); }
      return f.ledger.inspectOperation(...args);
    }, inspectReservation: async (...args: Parameters<typeof f.ledger.inspectReservation>) => {
      const saved = await f.ledger.inspectReservation(...args);
      // Initial inventory and per-leg read complete normally. Hold only the
      // genuine native backend read response inside keyless receipt recovery.
      if (args[1] === "nativeTransfer" && ++originalReads === 3) {
        blocked = true; await new Promise(resolve => setTimeout(resolve, 15000)); released = true;
      }
      return saved;
    } } as GatewayFundingLedger;
    const start = performance.now();
    const answer = await execute({ ...options(f), ledger }, composition(rpc), {
      operationDeadlineMs: 300000, keylessDeadlineMs: 10000, receiptPhaseDeadlineMs: 40000,
    }).runOperation(f.operation.operationId);
    const elapsed = performance.now() - start;
    expect(inspected).toBe(true); expect(blocked).toBe(true); expect(released).toBe(false);
    expect(answer.status).toBe("reconciliation-required"); expect(answer.stage).toBe("original-receipt");
    expect(elapsed).toBeGreaterThanOrEqual(9500); expect(elapsed).toBeLessThan(12000);
    expect(signing.calls).toBe(1); expect(signing.accounts).toBe(accounts); expect(writes(rpc)).toHaveLength(1);
    expect(f.snapshot()).toEqual(snapshot);
  }, 60000);
  it("rejects non-object, incomplete, extra-key and raised synthetic timing authority", async () => {
    const f = await fundingFixture(), synthetic = { origins: ["http://127.0.0.1:1", "http://127.0.0.1:2"] as const, circleEndpoint: "http://127.0.0.1:3/v1/balances" };
    const accounts = signing.accounts, snapshot = f.snapshot(), valid = { operationDeadlineMs: 300000, keylessDeadlineMs: 30000, receiptPhaseDeadlineMs: 40000 };
    const invalid = [null, false, {}, { ...valid, extra: 1 }, ...Object.keys(valid).flatMap(key =>
      [0, -1, 1.5, Number.MAX_SAFE_INTEGER, Infinity].map(value => ({ ...valid, [key]: value })))];
    for (const timings of invalid) {
      expect(() => execute(options(f), synthetic, timings as typeof valid)).toThrow();
      expect(() => recover(f.keyless, synthetic, timings as typeof valid)).toThrow();
    }
    expect(signing.calls).toBe(0); expect(signing.accounts).toBe(accounts); expect(f.snapshot()).toEqual(snapshot);
  }, 30000);
  it("bounds the caller while an already admitted protected controller call later persists only its original terminal fact", async () => {
    const f = await fundingFixture(), rpc = await fundingProtocol(f);
    let entered = false, persisted!: () => void;
    const completed = new Promise<void>(resolve => { persisted = resolve; });
    const terminalStore = { ...f.terminalStore, appendVerifiedTerminalObservation: async (...args: Parameters<typeof f.terminalStore.appendVerifiedTerminalObservation>) => {
      entered = true;
      await new Promise(resolve => setTimeout(resolve, 6000));
      try { return await f.terminalStore.appendVerifiedTerminalObservation(...args); } finally { persisted(); }
    } };
    const handle = execute({ ...options(f), terminalStore }, composition(rpc), {
      operationDeadlineMs: 300000, keylessDeadlineMs: 30000, receiptPhaseDeadlineMs: 5000,
    });
    const answer = await handle.runOperation(f.operation.operationId);
    expect(entered).toBe(true); expect(answer.status).toBe("reconciliation-required");
    expect(answer.stage).toBe("original-receipt"); expect(writes(rpc)).toHaveLength(1); expect(signing.calls).toBe(1);
    const before = await originals(f), funderBefore = await f.ledger.inspectNamespace(f.operation.policy.funder);
    expect(before[0]?.terminal).toBeUndefined(); expect(before.slice(1).every(s => s === null)).toBe(true);
    await completed;
    const after = await originals(f), funderAfter = await f.ledger.inspectNamespace(f.operation.policy.funder);
    expect(after[0]?.state).toBe("finalized-success"); expect(after[0]?.prepared).toEqual(before[0]?.prepared);
    expect(after[0]?.cryptoClaimId).toBe(before[0]?.cryptoClaimId); expect(after[0]?.broadcastClaimId).toBe(before[0]?.broadcastClaimId);
    expect(funderAfter.nextCryptoNonce).toBe("1"); expect(funderAfter.used).toEqual(funderBefore.used);
    expect(after.slice(1).every(s => s === null)).toBe(true);
    const snapshot = f.snapshot(), restarted = await recover(f.keyless, composition(rpc)).runOperation(f.operation.operationId);
    expect(restarted.stage).toBe("missing-original"); expect(f.snapshot()).toEqual(snapshot);
    expect(writes(rpc)).toHaveLength(1); expect(signing.calls).toBe(1);
  }, 90000);
  it("executes all four exact originals and only then reads Circle current availability; later calls refresh keylessly", async () => {
    const f = await fundingFixture(), rpc = await fundingProtocol(f), handle = execute(options(f), composition(rpc));
    const pending = handle.runOperation(f.operation.operationId); expect(handle.runOperation(f.operation.operationId)).toBe(pending);
    const ready = await pending; expect(ready.status, ready.stage).toBe("current-funding-ready");
    expect(ready.readiness?.availableMicros).toBe("100"); expect(ready.readiness?.basis).toBe("finalized-original-deposit-plus-current-available");
    expect(signing.calls).toBe(4); expect(writes(rpc)).toHaveLength(4);
    const saved = await originals(f); expect(saved.every(s => s?.state === "finalized-success" && s.terminal?.receiptStatus === "success")).toBe(true);
    expect(saved.map(s => s!.transaction.nonce)).toEqual(["0", "1", "0", "1"]);
    const circle = rpc.calls.filter(c => c.method === "circle-balances"); expect(circle).toHaveLength(1);
    expect(JSON.parse(circle[0].params[0])).toEqual({ token: "USDC", sources: [{ depositor: f.operation.policy.spend, domain: 26 }] });
    const before = canonicalJson(saved), snapshot = f.snapshot(); rpc.setAvailableMicros(BigInt(99));
    expect((await handle.runOperation(f.operation.operationId)).status).toBe("reconciliation-required");
    rpc.setAvailableMicros(BigInt(120)); expect((await handle.runOperation(f.operation.operationId)).readiness?.availableMicros).toBe("120");
    expect(writes(rpc)).toHaveLength(4); expect(signing.calls).toBe(4); expect(canonicalJson(await originals(f))).toBe(before);
    const forbidden = vi.fn(async () => { throw new Error("Keyless path cannot write"); });
    const keylessLedger = { ...f.ledger, admitOperation: forbidden, reserveStep: forbidden, claimCrypto: forbidden, savePrepared: forbidden, claimBroadcast: forbidden, appendCandidateObservation: forbidden } as GatewayFundingLedger;
    const accounts = signing.accounts;
    expect((await recover({ ...f.keyless, ledger: keylessLedger }, composition(rpc)).runOperation(f.operation.operationId)).status).toBe("current-funding-ready");
    expect(signing.accounts).toBe(accounts); expect(forbidden).not.toHaveBeenCalled(); expect(writes(rpc)).toHaveLength(4);
    expect(f.snapshot()).toEqual(snapshot);
  }, 180000);
  it.each([["0", "100"], ["50", "0"], ["0", "0"]])("skips only immutable zero movements native=%s USDC=%s without slots or cap refunds", async (nativeTransferWei, usdcTransferMicros) => {
    const f = await fundingFixture({ nativeTransferWei, usdcTransferMicros }), rpc = await fundingProtocol(f);
    const answer = await execute(options(f), composition(rpc)).runOperation(f.operation.operationId); expect(answer.status, answer.stage).toBe("current-funding-ready");
    const saved = await originals(f), count = 2 + Number(nativeTransferWei !== "0") + Number(usdcTransferMicros !== "0");
    expect(saved[0] === null).toBe(nativeTransferWei === "0"); expect(saved[1] === null).toBe(usdcTransferMicros === "0");
    expect(writes(rpc)).toHaveLength(count); expect(signing.calls).toBe(count);
    const [funder, spend] = await Promise.all([f.ledger.inspectNamespace(f.operation.policy.funder), f.ledger.inspectNamespace(f.operation.policy.spend)]);
    expect(BigInt(funder.used.gasWei) + BigInt(spend.used.gasWei)).toBe(BigInt(2610000)); // admission reserves all four ceilings
  }, 150000);
  it.each(["nativeTransfer", "usdcTransfer", "approval", "deposit"] as GatewayFundingStep[])("stops at a backend-validated reverted %s and never starts a dependent leg", async reverted => {
    const f = await fundingFixture(); let txHash: string | undefined;
    const rpc = await fundingProtocol(f, async (method, params, fallback) => {
      if (method === "eth_sendRawTransaction") { const slot = await f.ledger.inspectReservation(f.operation.operationId, reverted); if (slot?.prepared?.rawTransaction === params[0]) txHash = slot.prepared.transactionHash; }
      if (method === "eth_getTransactionReceipt" && params[0] === txHash) return { ...fallback as object, status: "0x0" };
    });
    const answer = await execute(options(f), composition(rpc)).runOperation(f.operation.operationId);
    const index = STEPS.indexOf(reverted), saved = await originals(f);
    const diagnostic = answer.status === "execution-reverted" ? answer.stage : JSON.stringify({ stage: answer.stage, step: answer.step,
      states: saved.map(original => original?.state ?? "absent"), originalSendCount: writes(rpc).length, protocol: rpc.diagnostics() });
    expect(answer.status, diagnostic).toBe("execution-reverted"); expect(answer.step).toBe(reverted);
    expect(saved[index]?.state).toBe("finalized-reverted");
    expect(saved.slice(index + 1).every(s => s === null)).toBe(true); expect(writes(rpc)).toHaveLength(index + 1); expect(signing.calls).toBe(index + 1);
    expect(rpc.calls.filter(c => c.method === "circle-balances")).toHaveLength(0);
    expect((await recover(f.keyless, composition(rpc)).runOperation(f.operation.operationId)).status).toBe("execution-reverted"); expect(writes(rpc)).toHaveLength(index + 1);
  }, 180000);
  it("polls an unknown original at most three times, then restart observes it without filling a missing dependent leg", async () => {
    const f = await fundingFixture(); let unknown = true;
    const rpc = await fundingProtocol(f, method => method === "eth_getTransactionReceipt" && unknown ? null : undefined);
    const handle = execute(options(f), composition(rpc)), answer = await handle.runOperation(f.operation.operationId);
    expect(answer.status).toBe("reconciliation-required"); expect(answer.step).toBe("nativeTransfer");
    expect(writes(rpc)).toHaveLength(1); expect(signing.calls).toBe(1);
    expect((await originals(f)).slice(1).every(s => s === null)).toBe(true);
    const attempts = rpc.calls.filter(c => c.method === "eth_getTransactionReceipt" && c.provider === 0); expect(attempts).toHaveLength(3);
    unknown = false; const restarted = await execute(options(f), composition(rpc)).runOperation(f.operation.operationId);
    expect(restarted.status).toBe("reconciliation-required"); expect(restarted.stage).toBe("missing-original");
    expect((await originals(f))[0]?.state).toBe("finalized-success"); expect(writes(rpc)).toHaveLength(1); expect(signing.calls).toBe(1);
  }, 90000);
  it.each(["reserved", "crypto-claimed"])("an existing %s original on restart is keyless-only and cannot resume", async state => {
    const f = await fundingFixture(), rpc = await fundingProtocol(f);
    await f.ledger.admitOperation(f.operation.operationId); await f.ledger.reserveStep(f.operation.operationId, "nativeTransfer", "0");
    if (state === "crypto-claimed") await f.ledger.claimCrypto(f.operation.operationId, "nativeTransfer", crypto.randomUUID());
    const before = canonicalJson(await originals(f)); expect((await execute(options(f), composition(rpc)).runOperation(f.operation.operationId)).status).toBe("reconciliation-required");
    expect(canonicalJson(await originals(f))).toBe(before); expect(writes(rpc)).toHaveLength(0); expect(signing.calls).toBe(0);
  }, 30000);
  it.each(["shared-balance-insufficient", "allowance-insufficient", "pending-nonce-drift"])("mandatory real dual preflight refuses %s with no extra physical send", async fault => {
    const f = await fundingFixture({ nativeTransferWei: "0", usdcTransferMicros: "0" }), rpc = await fundingProtocol(f, (method, _params, fallback) => {
      if (fault === "pending-nonce-drift" && method === "eth_getTransactionCount") return "0x1";
      if (fault === "allowance-insufficient" && method === "eth_call" && String((_params[0] as unknown as { data: string }).data).startsWith("0xdd62ed3e")) return `0x${"0".repeat(64)}`;
      return fallback;
    });
    if (fault === "shared-balance-insufficient") rpc.balances.set(f.operation.policy.spend, BigInt(100) * (BigInt(10) ** BigInt(12)));
    const answer = await execute(options(f), composition(rpc)).runOperation(f.operation.operationId); expect(answer.status).toBe("reconciliation-required");
    expect(writes(rpc)).toHaveLength(fault === "allowance-insufficient" ? 1 : 0); expect(signing.calls).toBe(fault === "allowance-insufficient" ? 1 : 0);
  }, 90000);
});
