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
import { A2A_RESEARCH_PACKAGE_VERSION } from "../lib/a2a/research-package.ts";

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
// Identify as Keryx's own headless driver so the route tags this self-generated call `engine`,
// not `a2a` — the dashboard's external bucket then reflects only genuine outside agents.
const askUrl = config.botKey
  ? `${config.baseUrl}/api/agent/ask?bot=${encodeURIComponent(config.botKey)}`
  : `${config.baseUrl}/api/agent/ask`;
type Completed = {
  status: "completed";
  queryId: string;
  answer: string;
  creatorsPaid: number;
  totalToCreators: number;
  citations: { source: string; reward: number }[];
  feePaid: number;
  totalPricePaid: number;
  pricing: { unusedCreatorReserveUsdc: number };
  researchPackage: {
    id: "keryx-quick" | "keryx-deep";
    version: string;
  };
  serviceReceipt: {
    targetMet: boolean;
    totalDurationMs: number;
    targetCompletionMs: number;
    objectiveKind: "provisional_slo";
    remedy: "none";
    quality?: {
      status: "measured" | "unavailable";
      groundedClaimRate: number | null;
    };
    portableReceiptUrl?: string;
  };
};
type Pending = {
  status: "queued" | "processing" | "review_required" | "failed";
  queryId: string;
  pollUrl: string;
  error?: string;
  message?: string;
  serviceStatus?: {
    elapsedMs: number;
    targetCompletionMs: number;
    targetBreached: boolean;
  };
};

const r = await gateway.pay<Completed | Pending>(
  askUrl,
  {
    method: "POST",
    body: {
      question,
      budget,
      responseMode: "async",
      packageVersion: A2A_RESEARCH_PACKAGE_VERSION,
    },
  },
);

console.log(`✅ Paid Keryx ${r.formattedAmount} USDC (settled ${String(r.transaction).slice(0, 10)}…)\n`);
let result = r.data;
while (result.status !== "completed") {
  if (result.status === "failed" || result.status === "review_required") {
    throw new Error(result.error ?? result.message ?? `A2A order ${result.status}`);
  }
  console.log(`   ${result.status}; polling ${result.queryId}…`);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const polled = await fetch(new URL(result.pollUrl, config.baseUrl), {
    headers: { accept: "application/json" },
  });
  if (!polled.ok) throw new Error(`A2A poll failed (${polled.status})`);
  result = (await polled.json()) as Completed | Pending;
}

console.log("📝 Keryx's answer:\n" + result.answer + "\n");
console.log(`💸 Keryx paid ${result.creatorsPaid} creator(s) $${result.totalToCreators} downstream:`);
for (const c of result.citations ?? []) console.log(`   • ${c.source}: $${c.reward}`);
console.log(`\n   Package: $${result.totalPricePaid} total = $${result.feePaid} service + $${result.totalToCreators} creators + $${result.pricing.unusedCreatorReserveUsdc} unused reserve.`);
console.log(
  `   Contract: ${result.researchPackage.id}@${result.researchPackage.version}; ${result.serviceReceipt.totalDurationMs}ms / ${result.serviceReceipt.targetCompletionMs}ms provisional SLO (${result.serviceReceipt.targetMet ? "met" : "missed"}).`,
);
if (result.serviceReceipt.quality) {
  const rate = result.serviceReceipt.quality.groundedClaimRate;
  console.log(
    `   Evidence quality: ${result.serviceReceipt.quality.status}${rate === null ? "" : `, ${(rate * 100).toFixed(1)}% grounded claims`}.`,
  );
}
if (result.serviceReceipt.portableReceiptUrl) {
  console.log(`   Portable receipt: ${new URL(result.serviceReceipt.portableReceiptUrl, config.baseUrl)}`);
}
console.log(
  "   Fixed-price and non-refundable; the provisional SLO has no remedy; one authorization can launch creators only once.\n",
);
process.exit(0);
