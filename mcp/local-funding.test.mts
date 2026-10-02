import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { GuardedArcSubmissionUnknownError } from "../lib/payments/guarded-arc-transaction.ts";
import { ensureLocalFunding, readFunding, recoverFunding } from "./local-funding.mts";

const mocks = vi.hoisted(() => ({ available: vi.fn(), send: vi.fn(), tx: vi.fn(), receipt: vi.fn(), allowance: BigInt(0) }));
vi.mock("../lib/gateway/gateway-balance.ts", () => ({ getGatewayAvailableAtomic: mocks.available }));
vi.mock("../lib/payments/guarded-arc-transaction.ts", async importOriginal => ({ ...(await importOriginal<typeof import("../lib/payments/guarded-arc-transaction.ts")>()), sendGuardedArcTransaction: mocks.send }));
vi.mock("viem", async importOriginal => ({ ...(await importOriginal<typeof import("viem")>()), createPublicClient: () => ({
  getBalance: async () => BigInt(1), readContract: async (request: { functionName: string }) => request.functionName === "allowance" ? mocks.allowance : BigInt(1_000_000),
  getTransaction: mocks.tx, waitForTransactionReceipt: mocks.receipt, getTransactionReceipt: mocks.receipt,
}) }));
const dirs: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keryx-mcp-funding-")); dirs.push(directory);
  const account = privateKeyToAccount(`0x${"11".repeat(32)}`), file = path.join(directory, "funding.json");
  const hashes = new Map<string, Record<string, unknown>>();
  mocks.allowance = BigInt(0);
  mocks.available.mockReset().mockResolvedValueOnce(BigInt(0)).mockResolvedValue(BigInt(100_000));
  mocks.send.mockReset().mockImplementation(async ({ transaction }: { transaction: Record<string, unknown> }) => {
    const hash = `0x${(hashes.size + 1).toString(16).padStart(64, "0")}`;
    hashes.set(hash, { hash, chainId: 5042002, from: account.address, to: transaction.to, input: transaction.data, value: BigInt(0) });
    expect(readFunding(file)?.status).toBe("pending");
    return hash;
  });
  mocks.tx.mockReset().mockImplementation(async ({ hash }: { hash: string }) => hashes.get(hash));
  mocks.receipt.mockReset().mockImplementation(async ({ hash }: { hash: string }) => ({ transactionHash: hash, status: "success" }));
  return { account, file, rpcUrl: "https://synthetic.invalid", required: BigInt(100_000), deposit: BigInt(500_000), hashes };
}

it("admits exact caller approval and deposit once and preserves terminal original hashes", async () => {
  const input = fixture(); await ensureLocalFunding(input);
  expect(mocks.send).toHaveBeenCalledTimes(2);
  const record = readFunding(input.file)!;
  expect(record).toMatchObject({ payer: input.account.address.toLowerCase(), amountMicros: "500000", status: "completed", phase: "credit" });
  expect(record.approvalHash).toBeDefined(); expect(record.transactionHash).toBeDefined();
  expect(await recoverFunding(input.file, input.rpcUrl)).toEqual(record);
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

it("retains a lost deposit response and blocks module-reopen retry until exact read-only recovery", async () => {
  const input = fixture(); mocks.allowance = BigInt(1_000_000);
  const hash: Hex = `0x${"ab".repeat(32)}`;
  mocks.send.mockImplementationOnce(async ({ transaction }: { transaction: Record<string, unknown> }) => {
    input.hashes.set(hash, { hash, chainId: 5042002, from: input.account.address, to: transaction.to, input: transaction.data, value: BigInt(0) });
    throw new GuardedArcSubmissionUnknownError(hash);
  });
  await expect(ensureLocalFunding(input)).rejects.toMatchObject({ transactionHash: hash });
  expect(readFunding(input.file)).toMatchObject({ status: "pending", phase: "deposit", transactionHash: hash });
  vi.resetModules(); const reopened = await import("./local-funding.mts");
  await expect(reopened.ensureLocalFunding(input)).rejects.toThrow(/Original funding/);
  expect(mocks.send).toHaveBeenCalledOnce();
  expect(await reopened.recoverFunding(input.file, input.rpcUrl)).toMatchObject({ status: "completed", transactionHash: hash });
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("keeps interrupted approval held after successful read-only receipt recovery", async () => {
  const input = fixture();
  const hash: Hex = `0x${"ab".repeat(32)}`;
  mocks.send.mockImplementationOnce(async ({ transaction }: { transaction: Record<string, unknown> }) => {
    input.hashes.set(hash, { hash, chainId: 5042002, from: input.account.address, to: transaction.to, input: transaction.data, value: BigInt(0) });
    throw new GuardedArcSubmissionUnknownError(hash);
  });
  await expect(ensureLocalFunding(input)).rejects.toThrow(/outcome is unknown/);
  expect(await recoverFunding(input.file, input.rpcUrl)).toMatchObject({ phase: "approval", status: "pending", transactionHash: hash });
  expect(mocks.send).toHaveBeenCalledOnce();
});

it("refuses mismatched original receipt and preserves the existing record without another transaction", async () => {
  const input = fixture(); await ensureLocalFunding(input);
  const record = { ...readFunding(input.file)!, status: "pending" }; fs.writeFileSync(input.file, JSON.stringify(record));
  mocks.receipt.mockResolvedValue({ transactionHash: `0x${"ff".repeat(32)}`, status: "success" });
  await expect(recoverFunding(input.file, input.rpcUrl)).rejects.toMatchObject({ transactionHash: record.transactionHash });
  expect(readFunding(input.file)?.status).toBe("pending"); expect(mocks.send).toHaveBeenCalledTimes(2);
});

it("treats missing Circle credit as unknown and creates no funding admission", async () => {
  const input = fixture(); mocks.available.mockReset().mockResolvedValue(null);
  await expect(ensureLocalFunding(input)).rejects.toThrow(/credit unavailable/);
  expect(mocks.send).not.toHaveBeenCalled(); expect(readFunding(input.file)).toBeNull();
});

it("delayed recovery never overwrites a replacement funding admission", async () => {
  const input = fixture(); await ensureLocalFunding(input);
  const original = { ...readFunding(input.file)!, status: "pending" }; fs.writeFileSync(input.file, JSON.stringify(original));
  let release!: () => void;
  mocks.receipt.mockImplementationOnce(async ({ hash }: { hash: string }) => {
    await new Promise<void>(resolve => { release = resolve; }); return { transactionHash: hash, status: "success" };
  });
  const pending = recoverFunding(input.file, input.rpcUrl);
  await expect(ensureLocalFunding(input)).rejects.toThrow(/Original funding/);
  const replacement = { ...original, id: "22222222-2222-4222-8222-222222222222", transactionHash: `0x${"ff".repeat(32)}` };
  fs.writeFileSync(input.file, JSON.stringify(replacement)); // Simulate an older writer that cannot honor the lock.
  release(); await expect(pending).rejects.toThrow(/changed during recovery/);
  expect(readFunding(input.file)).toEqual(replacement); expect(mocks.send).toHaveBeenCalledTimes(2);
});

it("inspects a crash-held original receipt without changing its journal or creating a new deposit", async () => {
  const input = fixture(); await ensureLocalFunding(input);
  const original = { ...readFunding(input.file)!, status: "pending" }; fs.writeFileSync(input.file, JSON.stringify(original));
  fs.mkdirSync(`${input.file}.lock`);
  expect(await recoverFunding(input.file, input.rpcUrl)).toMatchObject({ status: "pending", observation: "Original transaction receipt is success; held journal was not changed" });
  expect(readFunding(input.file)).toEqual(original); expect(fs.existsSync(`${input.file}.lock`)).toBe(true);
  expect(mocks.send).toHaveBeenCalledTimes(2);
});

it("archives terminal original evidence before admitting a distinct new funding attempt", async () => {
  const input = fixture(); await ensureLocalFunding(input); const first = readFunding(input.file)!;
  mocks.available.mockReset().mockResolvedValueOnce(BigInt(0)).mockResolvedValue(BigInt(100_000));
  mocks.allowance = BigInt(1_000_000); await ensureLocalFunding(input);
  expect(readFunding(`${input.file}.${first.id}.json`)).toEqual(first);
  expect(readFunding(input.file)?.id).not.toBe(first.id);
  expect(mocks.send).toHaveBeenCalledTimes(3);
});
