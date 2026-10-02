/** Native multi-process test fixture. It cannot construct a live transport. */
import { createInterface } from "node:readline";
import { createSyntheticPilotServerContext } from "./server-context";
import { HeuristicEngine } from "../llm/heuristic-engine";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { config } from "../config";

if (process.env.NODE_ENV !== "test") throw new Error("Synthetic fixture refused");
const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
const iterator = lines[Symbol.asyncIterator]();
async function input() {
  const line = await iterator.next();
  if (line.done || Buffer.byteLength(line.value) > 16384) throw new Error("Synthetic fixture refused");
  return JSON.parse(line.value);
}
const setup = await input();
const context = await createSyntheticPilotServerContext({ ...setup, engine: new HeuristicEngine(),
  rpcUrl: "http://127.0.0.1:1", fundedCapacityMicros: async () => 50000,
  seller: async () => { throw new Error("Synthetic fixture has no seller"); } });
process.stdout.write("ready\n");
try {
  const operation = await input();
  const grant = (await context.getGrant(operation.owner))!;
  if (operation.kind === "query") {
    const admitted = context.admissions.admitQuery(operation.queryId, operation.owner, grant.sessAddr, grant.grantEpoch, operation.amount);
    process.stdout.write(`${JSON.stringify({ admitted })}\n`);
  } else {
    const source = (await context.db.getSource(operation.sourceId))!;
    const requirements = { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress, amount: String(operation.amount),
      payTo: source.walletAddress, maxTimeoutSeconds: config.maxTimeoutSeconds,
      extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } };
    try {
      const result = await context.db.admitBrowserJournal({ sessionId: operation.owner, requestId: operation.requestId,
        queryId: operation.queryId, grantEpoch: grant.grantEpoch, signer: grant.sessAddr, network: profile.networkId,
        token: profile.usdcAddress, gatewayContract: profile.gatewayWallet, sourceId: source.id, offerId: null,
        kind: "fetch", payee: source.walletAddress, amountMicroUsdc: operation.amount, requirements,
        payment: { kind: "fetch", queryId: operation.queryId, sourceId: source.id, sourceName: source.name,
          payer: grant.sessAddr, payee: source.walletAddress, amountUsdc: operation.amount / 1e6,
          network: profile.networkId, grantEpoch: grant.grantEpoch, origin: "web" } });
      process.stdout.write(`${JSON.stringify({ admitted: result.status === "admitted" })}\n`);
    } catch { process.stdout.write('{"admitted":false}\n'); }
  }
} finally { context.close(); lines.close(); }
