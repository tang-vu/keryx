import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { decodeFunctionData, erc20Abi } from "viem";
import { syntheticStorageIdentity } from "../db/storage-identity-fixture";
import { validateGatewayFundingOperation } from "./gateway-funding-policy";
import { prepareGatewayFundingTransaction, type GatewayFundingTransaction } from "./gateway-funding-transaction";
import { createGatewayFundingPreflightForTrustedSyntheticComposition as compose, unsealVerifiedGatewayFundingPreflight as unseal,
  type GatewayFundingPreflightRequest, type VerifiedGatewayFundingPreflight } from "./gateway-funding-preflight";

const FUNDER = `0x${"11".repeat(20)}`, SPEND = `0x${"22".repeat(20)}`;
const USDC = "0x3600000000000000000000000000000000000000", GATEWAY = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const SCALE = BigInt(10) ** BigInt(12), NOW = 1800000000000, HASH = `0x${"ab".repeat(32)}`, OTHER_HASH = `0x${"cd".repeat(32)}`;
const q = (value: bigint | number | string) => `0x${BigInt(value).toString(16)}`;
const word = (value: bigint | number | string) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
function request(step: GatewayFundingTransaction["step"] = "nativeTransfer", changes: Record<string, unknown> = {}): GatewayFundingPreflightRequest {
  const identity = syntheticStorageIdentity("testnet-real");
  const operation = validateGatewayFundingOperation({ format: "gateway-funding-operation-v1", policy: {
    format: "gateway-funding-policy-v1", identity, policyId: randomUUID(), funder: FUNDER, spend: SPEND,
    lifetimeLimits: { nativeWei: "1000000000000", usdcMicros: "100", depositMicros: "100", gasWei: "2610000" }, maxTransactionGas: "120000", maxFeePerGasWei: "10" },
    operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64), minimumAvailableMicros: "100", initialAvailableMicros: "0",
    nativeTransferWei: "1000000000000", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
    gasLimits: { nativeTransfer: "21000", usdcTransfer: "60000", approval: "60000", deposit: "120000" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1", ...changes });
  return { operation, transaction: prepareGatewayFundingTransaction(operation, step, step === "nativeTransfer" || step === "usdcTransfer" ? "7" : "3"),
    expectedIdentity: identity, backendBindingDigest: "d".repeat(64), expectedNextCryptoNonces: { funder: "7", spend: "3" } };
}
interface Call { provider: number; method: string; params: unknown[]; count: number; }
type Hook = (result: unknown, call: Call) => unknown;
const servers: Server[] = [];
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
  server.closeAllConnections(); server.close(() => resolve()); }))); });
async function protocol(hook?: Hook, balances = { funder: BigInt(200) * SCALE, spend: BigInt(101) * SCALE }, allowance: bigint = BigInt(100)) {
  const calls: Call[] = [], origins: string[] = [];
  for (let provider = 0; provider < 2; provider++) {
    const counts = new Map<string, number>();
    const server = createServer(async (req, res) => {
      let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 8192) { res.destroy(); return; } }
      const body = JSON.parse(text), key = `${body.method}:${JSON.stringify(body.params)}`, count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count); const call: Call = { provider, method: body.method, params: body.params, count }; calls.push(call);
      let value: unknown;
      if (body.method === "eth_chainId") value = q(5042002);
      else if (body.method === "eth_getBlockByNumber") value = { number: "0xb", hash: HASH, timestamp: q(NOW / 1000 - 1) };
      else if (body.method === "eth_getBalance") value = q(body.params[0] === FUNDER ? balances.funder : balances.spend);
      else if (body.method === "eth_getTransactionCount") value = body.params[0] === FUNDER ? "0x7" : "0x3";
      else if (body.method === "eth_call") {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: body.params[0].data });
        if (decoded.functionName === "balanceOf") value = word(decoded.args[0].toLowerCase() === FUNDER ? balances.funder / SCALE : balances.spend / SCALE);
        else if (decoded.functionName === "allowance") {
          expect(decoded.args.map(String).map(v => v.toLowerCase())).toEqual([SPEND, GATEWAY]); value = word(allowance);
        } else throw new Error("Unexpected protocol method");
      } else throw new Error("Unexpected write method");
      if (hook) value = hook(value, call);
      const fault = value && typeof value === "object" && "wireFault" in value ? String(value.wireFault) : "";
      if (fault === "redirect") { res.writeHead(302, { location: "https://example.invalid" }); res.end(); return; }
      if (fault === "declared") { res.writeHead(200, { "content-length": "4194305" }); res.end("{}"); return; }
      if (fault === "utf8") { res.end(Buffer.from([255])); return; }
      if (fault === "invalid-json") { res.end("not-json"); return; }
      if (fault === "stall") return;
      if (fault === "wrong-id") { res.end(JSON.stringify({ jsonrpc: "2.0", id: 0, result: value })); return; }
      if (fault === "error-envelope") { res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -1 }, result: "0x4cef52" })); return; }
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value }));
    });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic listener failed");
    origins.push(`http://127.0.0.1:${address.port}/`);
  }
  return { origins: origins as [string, string], calls };
}
const evidence = async (r: GatewayFundingPreflightRequest, p: Awaited<ReturnType<typeof protocol>>) => {
  const token = await compose(p.origins, () => NOW)(r, () => {}); expect(token).not.toBeNull(); return unseal(token!, r, () => {});
};

describe("controlled read-only Arc funding preflight with actual localhost HTTP", () => {
  it.each(["nativeTransfer", "usdcTransfer", "approval", "deposit"] as const)("binds exact %s plan, dual balances/nonces and pinned allowance without additive balance counting", async step => {
    const r = request(step), p = await protocol(), e = await evidence(r, p);
    expect(e.transaction).toEqual(r.transaction); expect(e.expectedNextCryptoNonces).toEqual(r.expectedNextCryptoNonces);
    expect(e.funder.nativeWei).toBe((BigInt(200) * SCALE).toString()); expect(e.funder.usdcMicros).toBe("200");
    expect(e.requiredSpendNativeWei).toBe((BigInt(100) * SCALE + BigInt(step === "deposit" ? 1200000 : 1800000)).toString());
    if (step === "nativeTransfer") expect(e.requiredFunderNativeWei).toBe((BigInt(101) * SCALE + BigInt(810000)).toString());
    if (step === "usdcTransfer") expect(e.requiredFunderNativeWei).toBe((BigInt(100) * SCALE + BigInt(600000)).toString());
    expect(p.calls).toHaveLength(30); expect(p.calls.every(c => !/send|sign|write/.test(c.method))).toBe(true);
    for (const c of p.calls.filter(c => c.method === "eth_call")) { expect((c.params[0] as { to: string }).to).toBe(USDC); expect(c.params[1]).toBe("0xb"); }
    expect(Object.isFrozen(e)).toBe(true); expect(Object.isFrozen(e.spend)).toBe(true);
  });
  it("accepts the exact shared-balance floor with submicro native remainder", async () => {
    const r = request("deposit"), p = await protocol(undefined, { funder: BigInt(200) * SCALE + BigInt(19), spend: BigInt(100) * SCALE + BigInt(1200000) });
    expect((await evidence(r, p)).spend.usdcMicros).toBe("100");
  });
  it("uses the common lower finalized height when provider tips differ", async () => {
    const r = request(), p = await protocol((value, c) => c.method === "eth_getBlockByNumber" && c.params[0] === "finalized" && c.provider === 1
      ? { ...value as object, number: "0xc", hash: OTHER_HASH } : value);
    expect((await evidence(r, p)).anchor.number).toBe("11");
  });
  it.each(["funder-insolvent", "receiver-insolvent", "approval-insolvent", "deposit-insolvent", "low-allowance"])("keeps %s unknown", async fault => {
    const step = fault === "approval-insolvent" ? "approval" : fault === "deposit-insolvent" || fault === "low-allowance" ? "deposit" : "nativeTransfer";
    const p = await protocol(undefined, { funder: BigInt(fault === "funder-insolvent" ? 100 : 200) * SCALE,
      spend: fault === "receiver-insolvent" ? BigInt(0) : fault.includes("insolvent") && step !== "nativeTransfer" ? BigInt(100) * SCALE : BigInt(101) * SCALE },
      BigInt(fault === "low-allowance" ? 99 : 100));
    // Receiver insolvent even after both immutable incoming transfers.
    const r = request(step, fault === "receiver-insolvent" ? { nativeTransferWei: "1", usdcTransferMicros: "0" } : {});
    expect(await compose(p.origins, () => NOW)(r, () => {})).toBeNull();
  });
  it("handles exact-zero native transfer by starting with the positive USDC leg", async () => {
    const r = request("usdcTransfer", { nativeTransferWei: "0" }), p = await protocol();
    expect((await evidence(r, p)).requiredFunderNativeWei).toBe((BigInt(100) * SCALE + BigInt(600000)).toString());
  });
  it.each(["chain", "balance-disagreement", "shared-floor", "allowance-disagreement", "nonce-external", "nonce-drift", "stale-anchor", "future-anchor", "anchor-disagreement", "anchor-reorg", "finalized-backward", "finalized-reorg"])("refuses %s without nonce repair or evidence issuance", async fault => {
    const r = request("deposit"), p = await protocol((value, c) => {
      if (fault === "chain" && c.method === "eth_chainId" && c.count === 2) return "0x1";
      if (fault === "balance-disagreement" && c.method === "eth_getBalance" && c.provider === 1) return q(BigInt(102) * SCALE);
      if (fault === "shared-floor" && c.method === "eth_call" && String((c.params[0] as { data: string }).data).startsWith("0x70a08231")) return word(1);
      if (fault === "allowance-disagreement" && c.method === "eth_call" && String((c.params[0] as { data: string }).data).startsWith("0xdd62ed3e") && c.provider === 1) return word(101);
      if (c.method === "eth_getTransactionCount" && (fault === "nonce-external" || fault === "nonce-drift" && c.count === 2)) return "0x9";
      if (c.method === "eth_getBlockByNumber") {
        if (fault === "stale-anchor") return { ...value as object, timestamp: q(NOW / 1000 - 61) };
        if (fault === "future-anchor") return { ...value as object, timestamp: q(NOW / 1000 + 6) };
        if (fault === "anchor-disagreement" && c.params[0] !== "finalized" && c.provider === 1) return { ...value as object, hash: OTHER_HASH };
        if (fault === "anchor-reorg" && c.params[0] !== "finalized" && c.count === 2) return { ...value as object, hash: OTHER_HASH };
        if (fault === "finalized-reorg" && c.params[0] === "finalized" && c.count === 2) return { ...value as object, hash: OTHER_HASH };
        if (fault === "finalized-backward" && c.params[0] === "finalized" && c.count === 2) return { ...value as object, number: "0xa" };
      }
      return value;
    });
    const before = JSON.stringify(r), token = await compose(p.origins, () => NOW)(r, () => {});
    expect(token).toBeNull(); expect(JSON.stringify(r)).toBe(before); expect(() => unseal(token!, r, () => {})).toThrow("refused");
  });
  it("rejects uint256 overflow in required gas or anticipated receiver additions", async () => {
    const p = await protocol(undefined, { funder: BigInt(200) * SCALE, spend: BigInt(2) ** BigInt(256) - BigInt(1) });
    expect(await compose(p.origins, () => NOW)(request(), () => {})).toBeNull();
    const original = request("approval"), r = { ...original, operation: { ...original.operation as object,
      gasLimits: { nativeTransfer: "21000", usdcTransfer: "60000", approval: (BigInt(2) ** BigInt(256) - BigInt(1)).toString(), deposit: "120000" } } };
    // The shared immutable operation validator refuses overflowing admission
    // products before any read; preflight never adopts a repaired gas amount.
    const callsBefore = p.calls.length;
    expect(await compose(p.origins, () => NOW)(r, () => {})).toBeNull(); expect(p.calls).toHaveLength(callsBefore);
    const base = request(), maximum = (BigInt(2) ** BigInt(256) - BigInt(1)).toString();
    const op = validateGatewayFundingOperation({ ...base.operation as object,
      policy: { ...(base.operation as { policy: object }).policy, lifetimeLimits: { nativeWei: maximum, usdcMicros: "100", depositMicros: "100", gasWei: "2610000" } },
      nativeTransferWei: maximum, usdcTransferMicros: "0" });
    const aggregate = { ...base, operation: op, transaction: prepareGatewayFundingTransaction(op, "nativeTransfer", "7") };
    const huge = await protocol(undefined, { funder: BigInt(maximum), spend: BigInt(0) });
    expect(await compose(huge.origins, () => NOW)(aggregate, () => {})).toBeNull();
  });
  it("requires actual fixed Gateway allowance and never substitutes approval amount for allowance", async () => {
    const r = request("deposit"), p = await protocol(undefined, undefined, BigInt(0));
    expect(await compose(p.origins, () => NOW)(r, () => {})).toBeNull();
    const allowanceCalls = p.calls.filter(c => c.method === "eth_call" && (c.params[0] as { data: string }).data.startsWith("0xdd62ed3e"));
    expect(allowanceCalls).toHaveLength(2);
    for (const c of allowanceCalls) expect(decodeFunctionData({ abi: erc20Abi, data: (c.params[0] as { data: `0x${string}` }).data }).args?.map(String).map(v => v.toLowerCase())).toEqual([SPEND, GATEWAY]);
  });
  it("rejects forged tokens and binds full identity, backend, both barriers and exact original", async () => {
    const r = request(), p = await protocol(), token = await compose(p.origins, () => NOW)(r, () => {});
    expect(token).not.toBeNull(); expect(JSON.stringify(token)).toBe("{}");
    for (const fake of [{}, JSON.parse(JSON.stringify(token)), true, null]) expect(() => unseal(fake as VerifiedGatewayFundingPreflight, r, () => {})).toThrow("refused");
    for (const changed of [{ ...r, backendBindingDigest: "e".repeat(64) }, { ...r, expectedIdentity: { ...r.expectedIdentity, storageId: randomUUID() } },
      { ...r, expectedNextCryptoNonces: { ...r.expectedNextCryptoNonces, spend: "4" } }, { ...r, transaction: { ...r.transaction, valueWei: "2" } }])
      expect(() => unseal(token!, changed, () => {})).toThrow("refused");
    expect(() => unseal(token!, r, async () => {})).toThrow("refused");
  });
  it("copies immutable terms before reads and refuses mutation/drift before token issuance", async () => {
    const r = request(), before = structuredClone(r); let current = true;
    const p = await protocol((value, c) => { if (c.method === "eth_chainId" && c.count === 2) current = false; return value; });
    expect(await compose(p.origins, () => NOW)(r, () => { if (!current) throw new Error("drift"); })).toBeNull();
    expect(r).toEqual(before);
  });
  it("rechecks final mutation guard after complete sampling and evidence construction", async () => {
    const r = request(), p = await protocol(); let clocks = 0, current = true, finalGuardReached = false;
    const token = await compose(p.origins, () => { if (++clocks === 4) current = false; return NOW; })(r, () => {
      if (!current) { finalGuardReached = true; throw new Error("Synthetic final drift"); }
    });
    expect(clocks).toBe(4); expect(finalGuardReached).toBe(true); expect(p.calls).toHaveLength(30); expect(token).toBeNull();
  });
  it("refuses accessors, selected barrier mismatch and exhausted overflow before HTTP reads", async () => {
    const r = request(), p = await protocol(); let invoked = false;
    const accessor = { ...r }; Object.defineProperty(accessor, "backendBindingDigest", { enumerable: true, get() { invoked = true; return r.backendBindingDigest; } });
    expect(await compose(p.origins, () => NOW)(accessor, () => {})).toBeNull(); expect(invoked).toBe(false);
    for (const changed of [{ ...r, expectedNextCryptoNonces: { funder: "8", spend: "3" } },
      { ...r, expectedNextCryptoNonces: { funder: "7", spend: "9007199254740993" } }]) expect(await compose(p.origins, () => NOW)(changed, () => {})).toBeNull();
    expect(p.calls).toHaveLength(0);
  });
  it("refuses final elapsed deadline after all samples while synchronous final guard blocks timers", async () => {
    const r = request(), p = await protocol(); let freshnessReads = 0, reached = false, timerDelivered = false;
    const timer = setTimeout(() => { timerDelivered = true; }, 1000);
    try {
      const token = await compose(p.origins, () => { freshnessReads++; return NOW; }, { totalDeadlineMs: 1000, requestDeadlineMs: 1000 })(r, () => {
        if (freshnessReads === 4) { reached = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1100); expect(timerDelivered).toBe(false); }
      });
      expect(reached).toBe(true); expect(p.calls).toHaveLength(30); expect(token).toBeNull(); expect(() => unseal(token!, r, () => {})).toThrow("refused");
    } finally { clearTimeout(timer); }
  }, 5000);
  it("refuses elapsed per-request work while a synchronous post-response guard blocks its timer", async () => {
    const r = request(); let armed = false, reached = false, timerDelivered = false;
    const p = await protocol((value, c) => { if (c.method === "eth_chainId") armed = true; return value; });
    const timer = setTimeout(() => { timerDelivered = true; }, 100);
    try {
      const token = await compose(p.origins, () => NOW, { totalDeadlineMs: 2000, requestDeadlineMs: 100 })(r, () => {
        if (armed && !reached) { reached = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); expect(timerDelivered).toBe(false); }
      });
      expect(reached).toBe(true); expect(token).toBeNull(); expect(p.calls.every(c => c.method === "eth_chainId")).toBe(true);
    } finally { clearTimeout(timer); }
  }, 5000);
  it("expires an issued token after five seconds even if its unseal guard blocks timer delivery", async () => {
    const r = request(), p = await protocol(), token = await compose(p.origins, () => NOW)(r, () => {}); expect(token).not.toBeNull();
    let delivered = false; const timer = setTimeout(() => { delivered = true; }, 5000);
    try { expect(() => unseal(token!, r, () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100); expect(delivered).toBe(false); })).toThrow("refused"); }
    finally { clearTimeout(timer); }
  }, 10000);
  it.each(["redirect", "declared", "utf8", "invalid-json", "wrong-id", "error-envelope", "streamed"])("refuses %s HTTP evidence without retries or token recovery", async fault => {
    const r = request(), p = await protocol(() => fault === "streamed" ? " ".repeat(4194305) : { wireFault: fault });
    const token = await compose(p.origins, () => NOW)(r, () => {});
    expect(token).toBeNull(); expect(p.calls.length).toBeLessThanOrEqual(2);
    expect(() => unseal(token!, r, () => {})).toThrow("refused");
  });
  it("bounds actual stalled HTTP and never retries its read", async () => {
    const r = request(), p = await protocol(() => ({ wireFault: "stall" }));
    const token = await compose(p.origins, () => NOW, { totalDeadlineMs: 2000, requestDeadlineMs: 100 })(r, () => {});
    expect(token).toBeNull(); expect(p.calls).toHaveLength(2);
  });
  it("rejects a wrong-spender approval original before any provider read", async () => {
    const r = request("approval"), p = await protocol();
    const changed = { ...r, transaction: { ...r.transaction, data: `${r.transaction.data.slice(0, 10)}${"0".repeat(24)}${USDC.slice(2)}${r.transaction.data.slice(74)}` as `0x${string}` } };
    expect(await compose(p.origins, () => NOW)(changed, () => {})).toBeNull(); expect(p.calls).toHaveLength(0);
  });
  it("copies caller request before network mutation and cannot adopt the changed backend", async () => {
    const r = request(), original = structuredClone(r);
    const p = await protocol((value, c) => { if (c.method === "eth_chainId" && c.count === 1) (r as { backendBindingDigest: string }).backendBindingDigest = "e".repeat(64); return value; });
    const token = await compose(p.origins, () => NOW)(r, () => {});
    expect(token).not.toBeNull(); expect(unseal(token!, original, () => {}).backendBindingDigest).toBe(original.backendBindingDigest);
    expect(() => unseal(token!, r, () => {})).toThrow("refused");
  });
  it("captures native fetch and allows only distinct localhost origins/lower-only safe deadlines", async () => {
    const r = request(), p = await protocol(); vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Do not use replacement fetch"); }));
    expect((await evidence(r, p)).transaction).toEqual(r.transaction); expect(fetch).not.toHaveBeenCalled();
    expect(() => compose([p.origins[0], p.origins[0]])).toThrow("refused");
    expect(() => compose(["https://example.invalid/", p.origins[1]])).toThrow("refused");
    for (const limits of [{ totalDeadlineMs: 30001, requestDeadlineMs: 1 }, { totalDeadlineMs: 1, requestDeadlineMs: 5001 },
      { totalDeadlineMs: 0, requestDeadlineMs: 1 }, { totalDeadlineMs: 1, requestDeadlineMs: 0.5 }]) expect(() => compose(p.origins, () => NOW, limits)).toThrow("refused");
  });
});
