import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createPublicClient, encodeFunctionData, erc20Abi, type Hex, type PrivateKeyAccount } from "viem";
import { assertCallerJournalNetwork, CallerJournalNetworkMismatch, callerChain, callerProfile } from "./network-policy.mts";
import { attestedArcAuthorityHttp } from "../lib/arc-rpc-attestation.ts";
import { getGatewayAvailableAtomic } from "../lib/gateway/gateway-balance.ts";
import { ARC_GATEWAY_DEPOSIT_ABI, GuardedArcSubmissionUnknownError, sendGuardedArcTransaction } from "../lib/payments/guarded-arc-transaction.ts";

const USDC = callerProfile.usdcAddress;
const GATEWAY = callerProfile.gatewayWallet;
const recordSchema = z.object({ schema: z.enum(["keryx-mcp-funding-v1", "keryx-mcp-funding-v2"]),
  network: z.enum(["eip155:5042002", "eip155:5042"]).optional(), id: z.string().uuid(),
  payer: z.string().regex(/^0x[0-9a-f]{40}$/), amountMicros: z.string().regex(/^[1-9]\d{0,6}$/),
  requiredMicros: z.string().regex(/^[1-9]\d{0,6}$/), phase: z.enum(["approval", "deposit", "credit"]),
  status: z.enum(["pending", "completed", "reverted"]), transactionHash: z.string().regex(/^0x[0-9a-f]{64}$/i).optional(),
  approvalHash: z.string().regex(/^0x[0-9a-f]{64}$/i).optional() }).strict();
export type LocalFundingRecord = z.infer<typeof recordSchema>;
const unavailable = (): never => { throw new Error("Local funding journal unavailable; preserve it for owner recovery"); };

export function readFunding(file: string): LocalFundingRecord | null {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) unavailable();
    const record = recordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (record.schema === "keryx-mcp-funding-v2" ? !record.network : record.network !== undefined) unavailable();
    assertCallerJournalNetwork(record.network);
    return record;
  } catch (error) {
    if (error instanceof CallerJournalNetworkMismatch) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    return unavailable();
  }
}

function save(file: string, input: LocalFundingRecord): void {
  const value = recordSchema.parse(input);
  const temporary = `${file}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.renameSync(temporary, file);
    if (process.platform !== "win32") {
      const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY);
      try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
    }
  } catch { unavailable(); }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function clients(rpcUrl: string) {
  return createPublicClient({ chain: callerChain, transport: attestedArcAuthorityHttp(rpcUrl, { retryCount: 0, timeout: 4_000 }) });
}
function operation(record: LocalFundingRecord) {
  const approval = record.phase === "approval";
  return { to: approval ? USDC : GATEWAY,
    data: approval ? encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GATEWAY, BigInt(record.amountMicros)] })
      : encodeFunctionData({ abi: ARC_GATEWAY_DEPOSIT_ABI, functionName: "deposit", args: [USDC, BigInt(record.amountMicros)] }),
    value: BigInt(0), ...(approval ? {} : { gas: BigInt(120_000) }) };
}
async function confirm(record: LocalFundingRecord, rpcUrl: string, wait = true) {
  if (!record.transactionHash) throw new Error("Funding interrupted before a hash was retained; owner review required");
  const pub = clients(rpcUrl), hash = record.transactionHash as Hex;
  try {
    const [tx, receipt] = await Promise.all([pub.getTransaction({ hash }), wait
      ? pub.waitForTransactionReceipt({ hash, timeout: 90_000 }) : pub.getTransactionReceipt({ hash })]);
    const expected = operation(record);
    if (tx.hash.toLowerCase() !== hash.toLowerCase() || tx.chainId !== callerProfile.chainId
      || tx.from.toLowerCase() !== record.payer || tx.to?.toLowerCase() !== expected.to.toLowerCase()
      || tx.input.toLowerCase() !== expected.data.toLowerCase() || tx.value !== BigInt(0)
      || receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) throw new Error();
    if (receipt.status !== "success" && receipt.status !== "reverted") throw new Error();
    return receipt.status;
  } catch { throw new GuardedArcSubmissionUnknownError(hash); }
}

/** Read-only original-transaction recovery. Approval interruption never creates a deposit. */
export async function recoverFunding(file: string, rpcUrl: string) {
  let record = readFunding(file);
  if (!record) throw new Error("No local funding journal exists");
  if (record.status !== "pending") return record;
  const lock = `${file}.lock`;
  try { fs.mkdirSync(lock); }
  catch {
    let observation = "Original transaction has no retained hash; owner inspection required";
    if (record.transactionHash) {
      const status = await confirm(record, rpcUrl, false);
      observation = `Original transaction receipt is ${status}; held journal was not changed`;
    }
    return { ...record, observation, instructions: "Funding admission is held. Stop all buyer processes and have the owner inspect the original transaction and stale lock before removing a crash lock; recovery will not overwrite an active attempt" };
  }
  try {
    record = readFunding(file)!;
    if (!record || record.status !== "pending") return record;
    const original = record;
    const assertOriginal = () => {
      const current = readFunding(file);
      if (!current || current.id !== original.id || current.phase !== original.phase || current.status !== original.status
        || current.transactionHash !== original.transactionHash || current.payer !== original.payer
        || current.amountMicros !== original.amountMicros || current.requiredMicros !== original.requiredMicros)
        throw new Error("Funding journal changed during recovery; no original or replacement attempt was overwritten");
    };
    const status = await confirm(record, rpcUrl, false);
    if (status === "reverted") { assertOriginal(); const terminal = { ...record, status: "reverted" as const }; save(file, terminal); return terminal; }
    if (record.phase === "approval") return { ...record, instructions: "Original approval confirmed; interrupted funding requires owner review before a new deposit" };
    const available = await getGatewayAvailableAtomic(record.payer);
    if (available === null || available < BigInt(record.requiredMicros)) return { ...record, instructions: "Original deposit succeeded; Gateway credit is still unknown or insufficient. No new deposit submitted" };
    assertOriginal(); const terminal = { ...record, status: "completed" as const }; save(file, terminal); return terminal;
  } finally { fs.rmdirSync(lock); }
}

/** Existing caller funds only. Exclusive local admission remains held after any uncertain exit. */
export async function ensureLocalFunding(input: { account: PrivateKeyAccount; rpcUrl: string; file: string; required: bigint; deposit: bigint }) {
  const prior = readFunding(input.file);
  if (prior?.status === "pending") throw new Error("Original funding requires recovery; use keryx_recover before another deposit");
  const available = await getGatewayAvailableAtomic(input.account.address);
  if (available === null) throw new Error("Gateway credit unavailable; no deposit authorized");
  if (available >= input.required) return;
  const amount = input.required > input.deposit ? input.required : input.deposit;
  if (amount <= BigInt(0) || amount > BigInt(1_000_000) || input.required <= BigInt(0)) throw new Error("Funding limit is at most 1 USDC");
  const pub = clients(input.rpcUrl);
  const [balance, gas, allowance] = await Promise.all([
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [input.account.address] }),
    pub.getBalance({ address: input.account.address }),
    pub.readContract({ address: USDC, abi: erc20Abi, functionName: "allowance", args: [input.account.address, GATEWAY] }),
  ]);
  if (balance < amount || gas <= BigInt(0)) throw new Error(`Fund the configured caller wallet with ${callerProfile.label} USDC and gas before asking; no treasury fallback`);
  fs.mkdirSync(path.dirname(input.file), { recursive: true });
  const lock = `${input.file}.lock`;
  try { fs.mkdirSync(lock); } catch { throw new Error("Local funding admission is held; preserve the journal and lock for owner recovery"); }
  try {
    const current = readFunding(input.file);
    if (current?.status === "pending" || current?.id !== prior?.id) throw new Error("Funding state changed; inspect its original journal before another attempt");
    if (prior) {
      // Keep every terminal attempt, including its original hash, before admitting a new one.
      const archive = `${input.file}.${prior.id}.json`;
      fs.copyFileSync(input.file, archive, fs.constants.COPYFILE_EXCL);
      const archived = fs.openSync(archive, fs.constants.O_RDWR);
      try { fs.fsyncSync(archived); } finally { fs.closeSync(archived); }
    }
    let record: LocalFundingRecord = { schema: "keryx-mcp-funding-v2", network: callerProfile.networkId, id: randomUUID(), payer: input.account.address.toLowerCase(),
      amountMicros: amount.toString(), requiredMicros: input.required.toString(), phase: allowance < amount ? "approval" : "deposit", status: "pending" };
    save(input.file, record);
    async function send() {
      try {
        const hash = await sendGuardedArcTransaction({ account: input.account, rpcUrl: input.rpcUrl, transaction: operation(record) });
        record = { ...record, transactionHash: hash }; save(input.file, record);
      } catch (error) {
        if (error instanceof GuardedArcSubmissionUnknownError) {
          record = { ...record, transactionHash: error.transactionHash };
          try { save(input.file, record); } catch { /* Original preparing barrier remains held; return the known hash. */ }
          throw error;
        }
        if (record.transactionHash) throw new GuardedArcSubmissionUnknownError(record.transactionHash as Hex);
        throw error;
      }
      const outcome = await confirm(record, input.rpcUrl);
      if (outcome === "reverted") { record = { ...record, status: "reverted" }; save(input.file, record); throw new Error("Original funding transaction reverted; inspect its retained hash before a new attempt"); }
    }
    if (record.phase === "approval") {
      await send();
      record = { ...record, phase: "deposit", approvalHash: record.transactionHash, transactionHash: undefined }; save(input.file, record);
    }
    await send();
    record = { ...record, phase: "credit" }; save(input.file, record);
    const credited = await getGatewayAvailableAtomic(input.account.address);
    if (credited === null || credited < input.required) throw new Error(`Original deposit ${record.transactionHash} succeeded; Gateway credit needs recovery before another deposit`);
    save(input.file, { ...record, status: "completed" });
  } finally { fs.rmdirSync(lock); }
}
