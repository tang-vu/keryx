/** TEST ONLY. Actual isolated SQLite and native HTTP with generated synthetic
 * keys. No production consumer, wallet, environment file or settlement. */
import { createHash, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, erc20Abi, parseTransaction } from "viem";
import { canonicalJson } from "../canonical-json";
import { provisionSyntheticStorage } from "../db/storage-identity-fixture";
import { scanFullStorageSnapshot } from "../db/storage-identity-snapshot";
import { inspectGatewayFundingSqliteOwnerTarget, installGatewayFundingSqliteOwnerPolicy, installGatewayFundingSqliteOwnerAuthorization,
  openGatewayFundingSqliteLedger, openGatewayFundingSqliteTerminalObserver } from "../db/gateway-funding-sqlite";
import type { GatewayFundingStep } from "../db/gateway-funding-ledger-types";
import type { GatewayFundingOperation } from "./gateway-funding-policy";
import type { GatewayFundingExecutorOptions } from "./gateway-funding-executor";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "./gateway-funding-receipt-policy";

const servers: Server[] = [], directories: string[] = [], closers: (() => void)[] = [];
export async function cleanupFundingFixtures() {
  for (const close of closers.splice(0)) close();
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export async function fundingFixture(changes: Partial<GatewayFundingOperation> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "funding-operation-")); directories.push(dir);
  const file = join(dir, "application.sqlite"), identity = await provisionSyntheticStorage(file, "testnet-real");
  const funderPrivateKey = generatePrivateKey(), spendPrivateKey = generatePrivateKey();
  const policy = { format: "gateway-funding-policy-v1" as const, identity, policyId: randomUUID(), funder: privateKeyToAccount(funderPrivateKey).address.toLowerCase(),
    spend: privateKeyToAccount(spendPrivateKey).address.toLowerCase(), lifetimeLimits: { nativeWei: "100", usdcMicros: "200", depositMicros: "200", gasWei: "10000000" }, maxTransactionGas: "120000", maxFeePerGasWei: "20" };
  const reviewed = await inspectGatewayFundingSqliteOwnerTarget(file, identity);
  await installGatewayFundingSqliteOwnerPolicy(file, identity, { format: "gateway-funding-owner-installation-v1", policy, funderGasBudgetWei: "4000000", spendGasBudgetWei: "6000000",
    ...reviewed, finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    history: { format: "gateway-funding-empty-isolated-history-v1", documentDigest: "d".repeat(64), funderInitialNonce: "0", spendInitialNonce: "0" } });
  const operation = { format: "gateway-funding-operation-v1" as const, policy, operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64),
    minimumAvailableMicros: "100", initialAvailableMicros: "0", nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
    gasLimits: { nativeTransfer: "21000", usdcTransfer: "60000", approval: "60000", deposit: "120000" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1", ...changes };
  await installGatewayFundingSqliteOwnerAuthorization(file, identity, operation);
  const ledger = openGatewayFundingSqliteLedger(file, identity), terminalStore = openGatewayFundingSqliteTerminalObserver(file, identity);
  closers.push(() => ledger.close(), () => terminalStore.close());
  const options: GatewayFundingExecutorOptions = { ledger, expectedIdentity: identity, expectedBackendBindingDigest: reviewed.reviewedTargetDigest,
    installedPolicyDigest: createHash("sha256").update(canonicalJson(policy)).digest("hex"), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST,
    assertCurrentAuthority: () => {}, funderPrivateKey, spendPrivateKey };
  const { funderPrivateKey: _f, spendPrivateKey: _s, ...binding } = options;
  const snapshot = () => { const db = new DatabaseSync(file, { readOnly: true });
    try { db.exec("BEGIN"); return scanFullStorageSnapshot(db); } finally { db.close(); } };
  return { file, identity, operation, ledger, terminalStore, options, snapshot, keyless: { ...binding, terminalStore } };
}
export type FundingFixture = Awaited<ReturnType<typeof fundingFixture>>;
export interface FundingProtocolCall { method: string; params: string[]; provider: number; }
export type FundingProtocolHook = (method: string, params: string[], fallback: unknown, provider: number) => unknown | Promise<unknown>;
const q = (value: bigint | string | number) => `0x${BigInt(value).toString(16)}`;
const word = (value: bigint | string | number) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
const hash = (value: string) => `0x${createHash("sha256").update(value).digest("hex")}`;
export async function fundingProtocol(f: FundingFixture, hook?: FundingProtocolHook) {
  const calls: FundingProtocolCall[] = [], origins: string[] = [];
  const nonces = new Map([[f.operation.policy.funder, BigInt(0)], [f.operation.policy.spend, BigInt(0)]]);
  const balances = new Map([[f.operation.policy.funder, BigInt("1000000000000000000")], [f.operation.policy.spend, BigInt("1000000000000000000")]]);
  let allowance = BigInt(0), availableMicros = BigInt(100), height = 11;
  const blocks = new Map<string, object>(), receipts = new Map<string, object>(), transactions = new Map<string, object>();
  const anchor = () => { blocks.set(q(height), { number: q(height), hash: hash(`block-${height}`), timestamp: q(Math.floor(Date.now() / 1000) - 1), transactions: [] }); };
  anchor();
  const send = async (raw: string) => {
    const parsed = parseTransaction(raw as `0x${string}`);
    const step: GatewayFundingStep = parsed.to?.toLowerCase() === f.operation.policy.spend ? "nativeTransfer"
      : parsed.data?.startsWith("0xa9059cbb") ? "usdcTransfer" : parsed.data?.startsWith("0x095ea7b3") ? "approval" : "deposit";
    const saved = await f.ledger.inspectReservation(f.operation.operationId, step), p = saved?.prepared;
    if (!p || p.rawTransaction !== raw || !saved?.broadcastClaimId) throw new Error("Synthetic physical send lacks exact durable original");
    const t = p.transaction, number = ++height, blockHash = hash(`block-${number}`), timestamp = q(Math.floor(Date.now() / 1000) - 2);
    blocks.set(q(number), { number: q(number), hash: blockHash, timestamp, transactions: [p.transactionHash] }); height++; anchor();
    transactions.set(p.transactionHash, { hash: p.transactionHash, from: t.sender, to: t.to, input: t.data, type: "0x2", chainId: q(t.chainId), nonce: q(t.nonce), value: q(t.valueWei), gas: q(t.gas),
      maxFeePerGas: q(t.maxFeePerGasWei), maxPriorityFeePerGas: q(t.maxPriorityFeePerGasWei), r: parsed.r, s: parsed.s, yParity: q(parsed.yParity!), accessList: [], blockNumber: q(number), blockHash, transactionIndex: "0x0" });
    receipts.set(p.transactionHash, { transactionHash: p.transactionHash, from: t.sender, to: t.to, type: "0x2", status: "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x2", blockNumber: q(number), blockHash, transactionIndex: "0x0" });
    nonces.set(t.sender, BigInt(t.nonce) + BigInt(1));
    // Success effects are explicit synthetic protocol state, never settlement.
    // Revert tests stop at their original and cannot use these modeled effects
    // to authorize a dependent leg. Gas is always consumed, including revert.
    balances.set(t.sender, balances.get(t.sender)! - BigInt(21000) * BigInt(2));
    const scale = BigInt(10) ** BigInt(12);
    if (step === "nativeTransfer" || step === "usdcTransfer") {
      const amount = step === "nativeTransfer" ? BigInt(f.operation.nativeTransferWei) : BigInt(f.operation.usdcTransferMicros) * scale;
      balances.set(t.sender, balances.get(t.sender)! - amount); balances.set(f.operation.policy.spend, balances.get(f.operation.policy.spend)! + amount);
    } else if (step === "approval") allowance = BigInt(f.operation.approvalMicros);
    else { balances.set(t.sender, balances.get(t.sender)! - BigInt(f.operation.depositMicros) * scale); allowance -= BigInt(f.operation.depositMicros); }
    return p.transactionHash;
  };
  for (let provider = 0; provider < 2; provider++) {
    const server = createServer(async (req, res) => { try {
      res.setHeader("Connection", "close");
      let text = ""; for await (const chunk of req) { text += chunk; if (text.length > 8192) throw new Error(); }
      const body = JSON.parse(text);
      if (req.url === "/v1/balances") {
        calls.push({ method: "circle-balances", params: [text], provider });
        const fallback = { token: "USDC", balances: [{ depositor: f.operation.policy.spend, domain: 26,
          balance: `${availableMicros / BigInt(1000000)}.${(availableMicros % BigInt(1000000)).toString().padStart(6, "0")}` }] };
        const value = await hook?.("circle-balances", [text], fallback, provider); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(value === undefined ? fallback : value)); return;
      }
      const call = { method: body.method, params: body.params, provider }; calls.push(call);
      let fallback: unknown;
      if (body.method === "eth_chainId") fallback = "0x4cef52";
      else if (body.method === "eth_sendRawTransaction") fallback = await send(body.params[0]);
      else if (body.method === "eth_getBlockByNumber") fallback = blocks.get(body.params[0] === "finalized" ? q(height) : body.params[0]);
      else if (body.method === "eth_getBalance") fallback = q(balances.get(body.params[0])!);
      else if (body.method === "eth_getTransactionCount") fallback = q(nonces.get(body.params[0])!);
      else if (body.method === "eth_getTransactionByHash") fallback = transactions.get(body.params[0]) ?? null;
      else if (body.method === "eth_getTransactionReceipt") fallback = receipts.get(body.params[0]) ?? null;
      else if (body.method === "eth_call") {
        const decoded = decodeFunctionData({ abi: erc20Abi, data: body.params[0].data });
        fallback = word(decoded.functionName === "allowance" ? allowance : balances.get(String(decoded.args![0]).toLowerCase())! / (BigInt(10) ** BigInt(12)));
      } else throw new Error("Unexpected synthetic RPC");
      const value = await hook?.(body.method, body.params, fallback, provider);
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: value === undefined ? fallback : value }));
    } catch { res.destroy(); } });
    servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Synthetic listener unavailable"); origins.push(`http://127.0.0.1:${address.port}/`);
  }
  return { origins: origins as [string, string], calls, circleEndpoint: `${origins[0]}v1/balances`, balances, nonces,
    setAvailableMicros: (value: bigint) => { availableMicros = value; }, setAllowance: (value: bigint) => { allowance = value; } };
}
