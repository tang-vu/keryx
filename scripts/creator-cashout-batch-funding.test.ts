import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { keccak256, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { creatorCashoutFundingTransaction, creatorCashoutFunderKey, verifyCreatorCashoutFundingOriginal,
  CREATOR_CASHOUT_FUNDING_VALUE } from "./creator-cashout-batch-funding-original";
import { prepareCreatorCashoutFunding, sendCreatorCashoutFunding, recoverCreatorCashoutFunding,
  type FundingSendRpc, type FundingRecoveryRpc } from "./creator-cashout-batch-funding-execution";

const storageFault = vi.hoisted(() => ({ originalRead: false }));
vi.mock("./creator-cashout-batch-files", async importOriginal => {
  const actual = await importOriginal<typeof import("./creator-cashout-batch-files")>();
  return { ...actual, readCreatorBatchJson: async (file: string, ...args: [number?, boolean?]) => {
    if (storageFault.originalRead && file.endsWith("original.json")) throw new Error("Lost committed readback");
    return actual.readCreatorBatchJson(file, ...args);
  } };
});
const roots: string[] = [];
afterEach(() => {
  storageFault.originalRead = false;
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("cashout-funding-test-")) throw new Error("Unsafe fixture cleanup");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
const recipient = `0x${"ab".repeat(20)}` as Hex;
const hash = `0x${"12".repeat(32)}` as Hex;
const finalHash = `0x${"34".repeat(32)}` as Hex;
async function signedFixture(change: Record<string, unknown> = {}) {
  const signer = privateKeyToAccount(generatePrivateKey()), owner = signer.address.toLowerCase() as Hex;
  const transaction = { ...creatorCashoutFundingTransaction(recipient, 7), ...change };
  const serializedTransaction = await signer.signTransaction(transaction);
  return { signer, owner, original: { owner, recipient, nonce: 7,
    serializedTransaction, transactionHash: keccak256(serializedTransaction) } };
}
function preflightRpc(owner: string) {
  const block = { number: BigInt(100), hash, timestamp: BigInt(Math.floor(Date.now() / 1000)), baseFeePerGas: BigInt(20000000000) };
  const raw = {
    getChainId: vi.fn(async () => 5042002), getBlock: vi.fn(async () => block),
    getTransactionCount: vi.fn(async ({ address }: { address: string }): Promise<number> => address === owner ? 7 : 0),
    getCode: vi.fn(async () => undefined),
    getBalance: vi.fn(async ({ address }: { address: string }) => address === owner ? BigInt("1000000000000000000") : BigInt(0)),
    sendRawTransaction: vi.fn(async ({ serializedTransaction }: { serializedTransaction: Hex }) => keccak256(serializedTransaction)),
  };
  return { raw, rpc: raw as unknown as FundingSendRpc, block };
}
function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cashout-funding-test-")); fs.chmodSync(root, 0o700); roots.push(root);
  return path.join(root, "original");
}
async function preparedFixture() {
  const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner);
  const sign = vi.fn(f.signer.signTransaction);
  const result = await prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
    { address: f.signer.address, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner);
  const retained = JSON.parse(fs.readFileSync(path.join(dir, "original.json"), "utf8"));
  return { ...f, ...p, dir, result, retained, sign };
}
function recoveryRpc(f: Awaited<ReturnType<typeof preparedFixture>>) {
  const receipt = { transactionHash: f.retained.transactionHash, status: "success", from: f.owner, to: recipient,
    gasUsed: BigInt(21000), effectiveGasPrice: BigInt(25000000000), blockNumber: BigInt(100), blockHash: hash, transactionIndex: 0 };
  const included = { number: BigInt(100), hash, timestamp: f.block.timestamp - BigInt(1), transactions: [f.retained.transactionHash] };
  const finalized = { number: BigInt(101), hash: finalHash, timestamp: f.block.timestamp, transactions: [] };
  const transaction = { ...creatorCashoutFundingTransaction(recipient, 7), hash: f.retained.transactionHash, from: f.owner,
    input: "0x", blockHash: hash, blockNumber: BigInt(100), transactionIndex: 0, accessList: [] };
  const raw = { getChainId: vi.fn(async () => 5042002), getTransactionReceipt: vi.fn(async () => receipt),
    getTransaction: vi.fn(async () => transaction),
    getBlock: vi.fn(async (arg: { blockTag?: string; blockNumber?: bigint }) => arg.blockTag === "finalized" || arg.blockNumber === BigInt(101) ? finalized : included),
    sendRawTransaction: vi.fn(() => { throw new Error("Forbidden recovery send"); }) };
  return { raw, rpc: raw as unknown as FundingRecoveryRpc, receipt, included, finalized, transaction };
}

it("cryptographically verifies the exact .21 original and rejects the historical .010 amount", async () => {
  const f = await signedFixture();
  expect((await verifyCreatorCashoutFundingOriginal(f.original, f.owner)).transaction.value).toBe(CREATOR_CASHOUT_FUNDING_VALUE);
  await expect(verifyCreatorCashoutFundingOriginal(f.original)).rejects.toThrow();
  const legacy = await signedFixture({ value: BigInt("10000000000000000") });
  await expect(verifyCreatorCashoutFundingOriginal(legacy.original, legacy.owner)).rejects.toThrow();
});
it("refuses changed signed routing, chain, nonce, amount, fees, gas, calldata and access lists", async () => {
  for (const change of [{ chainId: 1 }, { to: `0x${"cd".repeat(20)}` }, { nonce: 8 },
    { value: CREATOR_CASHOUT_FUNDING_VALUE + BigInt(1) }, { gas: BigInt(21001) },
    { maxFeePerGas: BigInt(30000000001) }, { maxPriorityFeePerGas: BigInt(5000000001) },
    { data: "0x12" }, { accessList: [{ address: recipient, storageKeys: [] }] }]) {
    const f = await signedFixture(change);
    await expect(verifyCreatorCashoutFundingOriginal(f.original, f.owner)).rejects.toThrow();
  }
});
it("rejects changed metadata, hidden fields and a foreign signer", async () => {
  const f = await signedFixture();
  for (const change of [{ owner: recipient }, { recipient: f.owner }, { nonce: 8 },
    { transactionHash: hash }, { hidden: true }])
    await expect(verifyCreatorCashoutFundingOriginal({ ...f.original, ...change }, f.owner)).rejects.toThrow();
});
it("selects exactly one original funder field without interpreting other settings", async () => {
  const key = generatePrivateKey(), owner = privateKeyToAccount(key).address.toLowerCase();
  const selected = `KERYX_RPC_URL=$(forbidden)\nOTHER_PRIVATE_KEY=forbidden\nAGENT_FUNDER_PRIVATE_KEY='${key}' # retained\n`;
  expect(creatorCashoutFunderKey(selected, owner)).toBe(key);
  for (const text of [selected + `AGENT_FUNDER_PRIVATE_KEY=${key}`, `AGENT_FUNDER_PRIVATE_KEY=\"${key}\"x`,
    `BUYER_PRIVATE_KEY=${key}`, `AGENT_FUNDER_PRIVATE_KEY=${key}`]) {
    if (text === `AGENT_FUNDER_PRIVATE_KEY=${key}`) expect(() => creatorCashoutFunderKey(text, recipient)).toThrow();
    else expect(() => creatorCashoutFunderKey(text, owner)).toThrow();
  }
});

const linux = it.skipIf(process.platform !== "linux");
linux("creates one private original with the marker persisted before signing and exact readback", async () => {
  const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner);
  const sign = vi.fn(async (transaction: ReturnType<typeof creatorCashoutFundingTransaction>) => {
    expect(JSON.parse(fs.readFileSync(path.join(dir, "signing-attempt.json"), "utf8"))).toEqual({ owner: f.owner, recipient, nonce: 7 });
    return f.signer.signTransaction(transaction);
  });
  const result = await prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
    { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner);
  expect(sign).toHaveBeenCalledTimes(1); expect(result.amountWei).toBe("210000000000000000");
  expect(result.maxGasCostWei).toBe("630000000000000");
  expect((fs.statSync(path.join(dir, "original.json")).mode & 0o777)).toBe(0o600);
  await expect(prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
    { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
  expect(sign).toHaveBeenCalledTimes(1); expect(p.raw.sendRawTransaction).not.toHaveBeenCalled();
});
linux("retains consumed signing history after an unknown signing response or committed readback loss", async () => {
  for (const readbackLoss of [false, true]) {
    const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner);
    const sign = vi.fn(async (transaction: ReturnType<typeof creatorCashoutFundingTransaction>) => {
      const raw = await f.signer.signTransaction(transaction);
      if (!readbackLoss) throw new Error("Unknown signature response");
      storageFault.originalRead = true; return raw;
    });
    await expect(prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
      { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
    expect(fs.existsSync(path.join(dir, "signing-attempt.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "original.json"))).toBe(readbackLoss);
    storageFault.originalRead = false;
    await expect(prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
      { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
    expect(sign).toHaveBeenCalledTimes(1);
  }
});
linux("retains signed bytes when cancellation arrives during the signing call", async () => {
  const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner), controller = new AbortController();
  const sign = vi.fn(async (transaction: ReturnType<typeof creatorCashoutFundingTransaction>) => {
    const raw = await f.signer.signTransaction(transaction); controller.abort(); return raw;
  });
  const result = await prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
    { address: f.owner, signTransaction: sign }, p.rpc, controller.signal, f.owner);
  expect(result.state).toBe("funding-original-retained");
  expect((await verifyCreatorCashoutFundingOriginal(JSON.parse(fs.readFileSync(path.join(dir, "original.json"), "utf8")), f.owner)).transactionHash).toBe(result.transactionHash);
  expect(p.raw.sendRawTransaction).not.toHaveBeenCalled();
});
linux("never signs under wrong chain, pending nonce conflict, recipient use, gas spike or insolvency", async () => {
  for (const fault of ["chain", "nonce", "recipient-code", "recipient-funded", "gas", "insolvency", "future", "stale"]) {
    const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner), sign = vi.fn(f.signer.signTransaction);
    if (fault === "chain") p.raw.getChainId.mockResolvedValue(1);
    if (fault === "nonce") p.raw.getTransactionCount.mockImplementation(async ({ address }) => address === f.owner ? 8 : 0);
    if (fault === "recipient-code") p.raw.getCode.mockResolvedValue("0x12" as never);
    if (fault === "recipient-funded") p.raw.getBalance.mockResolvedValue(BigInt(1));
    if (fault === "gas") p.block.baseFeePerGas = BigInt(30000000001);
    if (fault === "insolvency") p.raw.getBalance.mockResolvedValue(BigInt(0));
    if (fault === "future") p.block.timestamp += BigInt(10);
    if (fault === "stale") p.block.timestamp -= BigInt(70);
    await expect(prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
      { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
    expect(sign).not.toHaveBeenCalled(); expect(fs.existsSync(dir)).toBe(false);
  }
});
linux("rechecks financial preflight after private review persistence and before signing", async () => {
  const f = await signedFixture(), dir = directory(), p = preflightRpc(f.owner), sign = vi.fn(f.signer.signTransaction);
  p.raw.getBalance.mockImplementation(async ({ address }) => address === f.owner
    ? fs.existsSync(path.join(dir, "review.json")) ? BigInt(0) : BigInt("1000000000000000000") : BigInt(0));
  await expect(prepareCreatorCashoutFunding(dir, { owner: f.owner, recipient, nonce: 7 },
    { address: f.owner, signTransaction: sign }, p.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
  expect(sign).not.toHaveBeenCalled(); expect(fs.existsSync(path.join(dir, "review.json"))).toBe(true);
});
linux("marks before one broadcast and retains send uncertainty without a second send", async () => {
  const f = await preparedFixture();
  f.raw.sendRawTransaction.mockImplementation(async ({ serializedTransaction }) => {
    expect(JSON.parse(fs.readFileSync(path.join(f.dir, "broadcast-attempt.json"), "utf8"))).toEqual({ transactionHash: f.retained.transactionHash });
    expect(serializedTransaction).toBe(f.retained.serializedTransaction); throw new Error("Lost broadcast response");
  });
  await expect(sendCreatorCashoutFunding(f.dir, f.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
  await expect(sendCreatorCashoutFunding(f.dir, f.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
  expect(f.raw.sendRawTransaction).toHaveBeenCalledTimes(1); expect(f.sign).toHaveBeenCalledTimes(1);
});
linux("concurrent callers broadcast the retained raw funding transaction at most once", async () => {
  const f = await preparedFixture();
  const results = await Promise.allSettled([sendCreatorCashoutFunding(f.dir, f.rpc, AbortSignal.timeout(10000), f.owner),
    sendCreatorCashoutFunding(f.dir, f.rpc, AbortSignal.timeout(10000), f.owner)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(f.raw.sendRawTransaction).toHaveBeenCalledTimes(1);
});
linux("recovers exact inclusion/finality twice without any signature, broadcast or storage writes", async () => {
  const f = await preparedFixture(), r = recoveryRpc(f), before = fs.readdirSync(f.dir);
  const result = await recoverCreatorCashoutFunding(f.dir, r.rpc, AbortSignal.timeout(10000), f.owner);
  expect(await recoverCreatorCashoutFunding(f.dir, r.rpc, AbortSignal.timeout(10000), f.owner)).toEqual(result);
  expect(result.state).toBe("funding-original-finalized-observed"); expect(result.amountWei).toBe("210000000000000000");
  expect(result.gasCostWei).toBe("525000000000000");
  expect(f.sign).toHaveBeenCalledTimes(1); expect(r.raw.sendRawTransaction).not.toHaveBeenCalled();
  expect(fs.readdirSync(f.dir)).toEqual(before);
});
linux("fails recovery closed on absent, conflicting or out-of-bounds original chain evidence", async () => {
  const f = await preparedFixture();
  for (const fault of ["missing", "failed", "recipient", "gas", "fee", "value", "block", "index", "finality", "stale"]) {
    const r = recoveryRpc(f);
    if (fault === "missing") r.raw.getTransactionReceipt.mockRejectedValue(new Error("Receipt absent"));
    if (fault === "failed") r.receipt.status = "reverted";
    if (fault === "recipient") r.receipt.to = f.owner;
    if (fault === "gas") r.receipt.gasUsed = BigInt(21001);
    if (fault === "fee") r.receipt.effectiveGasPrice = BigInt(30000000001);
    if (fault === "value") r.transaction.value += BigInt(1);
    if (fault === "block") r.included.hash = finalHash;
    if (fault === "index") r.receipt.transactionIndex = 1;
    if (fault === "finality") r.finalized.number = BigInt(99);
    if (fault === "stale") r.finalized.timestamp -= BigInt(70);
    await expect(recoverCreatorCashoutFunding(f.dir, r.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
    expect(r.raw.sendRawTransaction).not.toHaveBeenCalled();
  }
});
linux("refuses missing, altered, linked or public original custody without broadcast", async () => {
  for (const fault of ["missing-marker", "altered-original", "hardlink", "public", "symlink"]) {
    const f = await preparedFixture(), file = path.join(f.dir, "original.json");
    if (fault === "missing-marker") fs.unlinkSync(path.join(f.dir, "signing-attempt.json"));
    if (fault === "altered-original") fs.writeFileSync(file, JSON.stringify({ ...f.retained, nonce: 8 }));
    if (fault === "hardlink") fs.linkSync(file, path.join(f.dir, "linked.json"));
    if (fault === "public") fs.chmodSync(file, 0o644);
    if (fault === "symlink") { fs.renameSync(file, path.join(f.dir, "saved.json")); fs.symlinkSync(path.join(f.dir, "saved.json"), file); }
    await expect(sendCreatorCashoutFunding(f.dir, f.rpc, AbortSignal.timeout(10000), f.owner)).rejects.toThrow();
    expect(f.raw.sendRawTransaction).not.toHaveBeenCalled();
  }
});
linux("actual Linux CLI help and missing-original refusal need neither keys nor network", () => {
  const cli = fileURLToPath(new URL("./creator-cashout-batch-funding.mts", import.meta.url));
  const run = (args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args],
    { encoding: "utf8", timeout: 15000, env: { NODE_ENV: "test" } });
  const help = run(["--help"]);
  expect(help.status).toBe(0); expect(help.stdout).toContain("Exactly .21 native Arc-testnet USDC");
  const dir = directory(); fs.mkdirSync(dir, { mode: 0o700 });
  const missing = run(["--recover", "--directory", dir, "--rpc", "https://rpc.testnet.arc.network"]);
  expect(missing.status).toBe(1); expect(missing.stdout).toBe("");
  expect(missing.stderr).toContain("Never recreate, resign or rebroadcast");
  expect(fs.readdirSync(dir)).toEqual([]);
}, 35000);
