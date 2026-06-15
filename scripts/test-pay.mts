/**
 * test-pay — isolated diagnostic for the real x402 settlement path.
 * Reuses a persistent test wallet (data/test-wallet.json, gitignored) so we don't re-fund each run.
 * Funds + deposits if the Gateway balance is low, prints the FULL balance object, then pays one
 * source endpoint and prints the result or the detailed error.
 *
 * Usage: node --import tsx --env-file-if-exists=.env.local scripts/test-pay.mts [sourceId]
 */

import fs from "node:fs";
import path from "node:path";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";

const STORE = path.resolve(process.cwd(), "data", "test-wallet.json");
fs.mkdirSync(path.dirname(STORE), { recursive: true });
let key: `0x${string}`;
try {
  key = JSON.parse(fs.readFileSync(STORE, "utf8")).privateKey;
} catch {
  key = generatePrivateKey();
  fs.writeFileSync(STORE, JSON.stringify({ privateKey: key, address: privateKeyToAccount(key).address }, null, 2));
}
const acct = privateKeyToAccount(key);
console.log("test wallet:", acct.address);

const gateway = new GatewayClient({ chain: config.network as SupportedChainName, privateKey: key, rpcUrl: config.rpcUrl });
const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
const pub = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
const fw = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });

const fmt = (b: Awaited<ReturnType<typeof gateway.getBalances>>) =>
  `wallet=${b.wallet.formatted} | gw.total=${b.gateway.formattedTotal} avail=${b.gateway.formattedAvailable} withdrawing=${b.gateway.formattedWithdrawing}`;

let bal = await gateway.getBalances();
console.log("before:", fmt(bal));

if (bal.gateway.available < parseUnits("0.5", 6)) {
  console.log("funding + depositing 1 USDC…");
  const gtx = await fw.sendTransaction({ to: acct.address, value: parseEther("0.05") });
  await pub.waitForTransactionReceipt({ hash: gtx });
  const utx = await fw.writeContract({ address: config.usdcAddress, abi: erc20Abi, functionName: "transfer", args: [acct.address, parseUnits("1", 6)] });
  await pub.waitForTransactionReceipt({ hash: utx });
  const dep = await gateway.deposit("1");
  console.log("deposit tx:", dep.depositTxHash);
  for (let i = 0; i < 30; i++) {
    bal = await gateway.getBalances();
    console.log(`  poll ${i}: ${fmt(bal)}`);
    if (bal.gateway.available >= parseUnits("1", 6)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const db = await getDb();
const sources = await db.listSources();
const sid = process.argv[2] ?? sources[0].id;
const url = `${config.baseUrl}/api/source/${sid}`;
console.log("paying:", url, "| maxTimeoutSeconds:", config.maxTimeoutSeconds);
try {
  const r = await gateway.pay<{ content?: string }>(url);
  console.log("✅ PAID:", { amount: r.formattedAmount, tx: r.transaction, status: r.status });
} catch (e) {
  console.error("❌ pay error:", e instanceof Error ? e.message : String(e));
}
console.log("after:", fmt(await gateway.getBalances()));
process.exit(0);
