/** TEST ONLY: generated protocol state served by native localhost HTTP.
 * This models provider evidence, never external settlement or owner permission. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { decodeFunctionData, erc20Abi, keccak256, parseTransaction } from "viem";
import type { GatewayFundingLedger, GatewayFundingStep } from "../lib/db/gateway-funding-ledger-types";
import type { GatewayFundingOperation } from "../lib/payments/gateway-funding-policy";
import { validateSignedGatewayFundingTransaction } from "../lib/payments/gateway-funding-transaction";

const q = (n: bigint | number | string) => `0x${BigInt(n).toString(16)}`;
const word = (n: bigint) => `0x${n.toString(16).padStart(64, "0")}`;
const hash = (s: string) => `0x${createHash("sha256").update(s).digest("hex")}`;
export type ReceiptMode = "success" | "missing" | "disagreement" | "reverted";
export async function postgresFundingProtocol(ledger: GatewayFundingLedger, operation: Readonly<GatewayFundingOperation>, mode: ReceiptMode) {
  const servers: Server[] = [], origins: string[] = [];
  const fixtureFailures: string[] = [];
  const calls: { method: string; provider: number }[] = [], sends: { step: GatewayFundingStep; hash: string; raw: string }[] = [];
  const nonces = new Map([[operation.policy.funder, 0n], [operation.policy.spend, 0n]]);
  const balances = new Map([[operation.policy.funder, 1000000000000000000n], [operation.policy.spend, 1000000000000000000n]]);
  const blocks = new Map<string, unknown>(), receipts = new Map<string, unknown>(), transactions = new Map<string, unknown>();
  let height = 11, allowance = 0n;
  const anchor = () => blocks.set(q(height), { number: q(height), hash: hash(`block-${height}`), timestamp: q(Math.floor(Date.now() / 1000) - 1), transactions: [] });
  anchor();
  async function send(raw: `0x${string}`) {
    const parsed = parseTransaction(raw);
    const step: GatewayFundingStep = parsed.to?.toLowerCase() === operation.policy.spend ? "nativeTransfer"
      : parsed.data?.startsWith("0xa9059cbb") ? "usdcTransfer" : parsed.data?.startsWith("0x095ea7b3") ? "approval" : "deposit";
    const saved = await ledger.inspectReservation(operation.operationId, step), prepared = saved?.prepared;
    assert(prepared && saved.cryptoClaimId && saved.broadcastClaimId, "send requires durable crypto, bytes and broadcast claim");
    assert.equal(prepared.rawTransaction, raw); assert.equal(prepared.transactionHash, keccak256(raw));
    await validateSignedGatewayFundingTransaction(operation, step, saved.transaction.nonce,
      { rawTransaction: raw, transactionHash: prepared.transactionHash }, () => {});
    assert(!sends.some(s => s.hash === prepared.transactionHash), "no resend or replacement");
    const t = prepared.transaction; assert.equal(BigInt(t.nonce), nonces.get(t.sender));
    sends.push({ step, hash: prepared.transactionHash, raw });
    const inclusion = ++height, blockHash = hash(`block-${inclusion}`);
    blocks.set(q(inclusion), { number: q(inclusion), hash: blockHash, timestamp: q(Math.floor(Date.now() / 1000) - 2), transactions: [prepared.transactionHash] });
    height++; anchor();
    transactions.set(prepared.transactionHash, { hash: prepared.transactionHash, from: t.sender, to: t.to, input: t.data,
      type: "0x2", chainId: q(t.chainId), nonce: q(t.nonce), value: q(t.valueWei), gas: q(t.gas), maxFeePerGas: q(t.maxFeePerGasWei),
      maxPriorityFeePerGas: q(t.maxPriorityFeePerGasWei), accessList: [], r: parsed.r, s: parsed.s, yParity: q(parsed.yParity!),
      blockNumber: q(inclusion), blockHash, transactionIndex: "0x0" });
    receipts.set(prepared.transactionHash, { transactionHash: prepared.transactionHash, from: t.sender, to: t.to, type: "0x2",
      status: mode === "reverted" ? "0x0" : "0x1", gasUsed: "0x5208", effectiveGasPrice: "0x2", blockNumber: q(inclusion), blockHash, transactionIndex: "0x0" });
    nonces.set(t.sender, BigInt(t.nonce) + 1n);
    balances.set(t.sender, balances.get(t.sender)! - 42000n);
    // Negative cases stop at the first original. Only success mode models
    // subsequent solvency; uncertain/reverted cases claim no post-send economics.
    if (mode === "success") {
      if (step === "nativeTransfer" || step === "usdcTransfer") {
        const amount = step === "nativeTransfer" ? BigInt(operation.nativeTransferWei) : BigInt(operation.usdcTransferMicros) * 1000000000000n;
        balances.set(t.sender, balances.get(t.sender)! - amount); balances.set(operation.policy.spend, balances.get(operation.policy.spend)! + amount);
      } else if (step === "approval") allowance = BigInt(operation.approvalMicros);
      else { balances.set(t.sender, balances.get(t.sender)! - BigInt(operation.depositMicros) * 1000000000000n); allowance -= BigInt(operation.depositMicros); }
    }
    return prepared.transactionHash;
  }
  try {
    for (let provider = 0; provider < 2; provider++) {
      const server = createServer(async (req, res) => { try {
        assert.equal(req.method, "POST"); res.setHeader("Connection", "close"); res.setHeader("Content-Type", "application/json");
        let text = "", bytes = 0; for await (const chunk of req) { bytes += Buffer.byteLength(chunk); assert(bytes <= 8192); text += String(chunk); }
        const body = JSON.parse(text); let result: unknown;
        if (req.url === "/v1/balances") {
          calls.push({ method: "circle-balances", provider });
          assert.deepEqual(body, { token: "USDC", sources: [{ depositor: operation.policy.spend, domain: 26 }] });
          assert.equal(sends.length, 4, "Circle sampled only after four originals");
          assert.equal((await ledger.inspectReservation(operation.operationId, "deposit"))?.state, "finalized-success");
          res.end(JSON.stringify({ token: "USDC", balances: [{ depositor: operation.policy.spend, domain: 26, balance: "0.000100" }] })); return;
        }
        assert.equal(req.url, "/"); calls.push({ method: body.method, provider });
        if (body.method === "eth_chainId") result = q(5042002);
        else if (body.method === "eth_sendRawTransaction") { assert.equal(provider, 0); result = await send(body.params[0]); }
        else if (body.method === "eth_getBlockByNumber") result = blocks.get(body.params[0] === "finalized" ? q(height) : body.params[0]);
        else if (body.method === "eth_getBalance") { assert(blocks.has(body.params[1])); result = q(balances.get(body.params[0].toLowerCase())!); }
        else if (body.method === "eth_getTransactionCount") { assert.equal(body.params[1], "pending"); result = q(nonces.get(body.params[0].toLowerCase())!); }
        else if (body.method === "eth_call") {
          assert.equal(body.params[0].to.toLowerCase(), "0x3600000000000000000000000000000000000000"); assert(blocks.has(body.params[1]));
          const decoded = decodeFunctionData({ abi: erc20Abi, data: body.params[0].data });
          if (decoded.functionName === "balanceOf") result = word(balances.get(String(decoded.args![0]).toLowerCase())! / 1000000000000n);
          else { assert.equal(decoded.functionName, "allowance"); assert.equal(String(decoded.args![0]).toLowerCase(), operation.policy.spend);
            assert.equal(String(decoded.args![1]).toLowerCase(), "0x0077777d7eba4688bdef3e311b846f25870a19b9"); result = word(allowance); }
        } else if (body.method === "eth_getTransactionByHash") result = transactions.get(body.params[0]) ?? null;
        else if (body.method === "eth_getTransactionReceipt") result = mode === "missing" || mode === "disagreement" && provider === 1 ? null : receipts.get(body.params[0]) ?? null;
        else throw new Error("Unexpected synthetic protocol method");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      } catch { fixtureFailures.push("Synthetic protocol assertion failed"); res.writeHead(500); res.end("{}"); } });
      servers.push(server); await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
      const address = server.address(); assert(address && typeof address !== "string"); origins.push(`http://127.0.0.1:${address.port}/`);
    }
  } catch (error) { for (const server of servers) server.close(); throw error; }
  return { origins: origins as [string, string], circleEndpoint: `${origins[0]}v1/balances`, calls, sends, fixtureFailures,
    close: async () => { await Promise.all(servers.map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }))); assert.deepEqual(fixtureFailures, [], "unexpected fixture errors cannot count as intended unknown"); } };
}
