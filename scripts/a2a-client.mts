/**
 * a2a-client — a DEMO external agent that pays Keryx (x402) to answer a question.
 * Proves the recursive citation economy: this agent pays Keryx's research fee → Keryx then
 * autonomously pays the creators it cites. Uses its own persistent wallet (data/a2a-client-wallet.json).
 *
 * Usage: node --import tsx --env-file-if-exists=.env.local scripts/a2a-client.mts "question" [budget]
 */

import fs from "node:fs";
import path from "node:path";
import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, parseUnits } from "viem";
import { arcTestnet } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "../lib/config.ts";

const STORE = path.resolve(process.cwd(), "data", "a2a-client-wallet.json");
fs.mkdirSync(path.dirname(STORE), { recursive: true });
let key: `0x${string}`;
try {
  key = JSON.parse(fs.readFileSync(STORE, "utf8")).privateKey;
} catch {
  key = generatePrivateKey();
  fs.writeFileSync(STORE, JSON.stringify({ privateKey: key, address: privateKeyToAccount(key).address }, null, 2));
}
const acct = privateKeyToAccount(key);
const gateway = new GatewayClient({ chain: config.network as SupportedChainName, privateKey: key, rpcUrl: config.rpcUrl });
const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
const pub = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
const fw = createWalletClient({ account: funder, chain: arcTestnet, transport: http(config.rpcUrl) });

const question = process.argv[2] ?? "What makes an AI agent's spending decisions rational under a budget?";
const budget = process.argv[3] ? parseFloat(process.argv[3]) : 0.03;

console.log(`\n🤖 External agent ${acct.address}`);
console.log(`   paying Keryx to answer: "${question}"\n`);

// Fund this client agent's Gateway balance if low.
let bal = await gateway.getBalances();
if (bal.gateway.available < parseUnits("0.1", 6)) {
  console.log("   funding client agent wallet…");
  const g = await fw.sendTransaction({ to: acct.address, value: parseEther("0.05") });
  await pub.waitForTransactionReceipt({ hash: g });
  const u = await fw.writeContract({ address: config.usdcAddress, abi: erc20Abi, functionName: "transfer", args: [acct.address, parseUnits("1", 6)] });
  await pub.waitForTransactionReceipt({ hash: u });
  await gateway.deposit("1");
  for (let i = 0; i < 30; i++) {
    bal = await gateway.getBalances();
    if (bal.gateway.available >= parseUnits("1", 6)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

console.log(`   client Gateway balance: ${bal.gateway.formattedAvailable} USDC\n`);
const r = await gateway.pay<{ answer: string; creatorsPaid: number; totalToCreators: number; citations: { source: string; reward: number }[]; feePaid: number }>(
  `${config.baseUrl}/api/agent/ask`,
  { method: "POST", body: { question, budget } },
);

console.log(`✅ Paid Keryx ${r.formattedAmount} USDC (settled ${String(r.transaction).slice(0, 10)}…)\n`);
console.log("📝 Keryx's answer:\n" + r.data.answer + "\n");
console.log(`💸 Keryx paid ${r.data.creatorsPaid} creator(s) $${r.data.totalToCreators} downstream:`);
for (const c of r.data.citations ?? []) console.log(`   • ${c.source}: $${c.reward}`);
console.log(`\n   Net: external agent → Keryx ($${r.data.feePaid}) → creators ($${r.data.totalToCreators}). Recursive citation economy. ✨\n`);
process.exit(0);
