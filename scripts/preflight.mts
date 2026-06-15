/**
 * preflight — go-live readiness check for REAL Arc-testnet settlement.
 * Reports: LLM provider, funder wallet gas (native USDC) + spendable USDC (ERC-20),
 * offline flag, and registered source count. Tells you exactly what's left before going live.
 *
 * Usage: npm run preflight
 */

import { createPublicClient, http, erc20Abi, formatUnits, formatEther } from "viem";
import { arcTestnet } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config, hasLlm, llmProvider } from "../lib/config.ts";
import { getDb } from "../lib/db/index.ts";

const ok = (b: boolean) => (b ? "✅" : "❌");
const line = "─".repeat(56);

console.log(`\nKeryx — go-live preflight\n${line}`);

// LLM
const llm = hasLlm();
console.log(`${ok(llm)} LLM provider: ${llmProvider()}${llm ? "" : "  → set DEEPSEEK_API_KEY (or ANTHROPIC_API_KEY) in .env.local"}`);

// Offline flag
const forcedOffline = process.env.KERYX_FORCE_OFFLINE === "1";
console.log(`${ok(!forcedOffline)} KERYX_FORCE_OFFLINE=${process.env.KERYX_FORCE_OFFLINE ?? "0"}${forcedOffline ? "  → set to 0 to settle for real" : ""}`);

// Wallet
let gasOk = false;
let usdcOk = false;
if (!config.funderKey) {
  console.log(`❌ Funder wallet: AGENT_FUNDER_PRIVATE_KEY not set (run npm run generate-wallets)`);
} else {
  const funder = privateKeyToAccount(config.funderKey as `0x${string}`);
  const pc = createPublicClient({ chain: arcTestnet, transport: http(config.rpcUrl) });
  try {
    const [native, usdc] = await Promise.all([
      pc.getBalance({ address: funder.address }),
      pc.readContract({ address: config.usdcAddress, abi: erc20Abi, functionName: "balanceOf", args: [funder.address] }),
    ]);
    gasOk = native > 0n;
    usdcOk = usdc > 0n;
    console.log(`   Funder wallet: ${funder.address}`);
    console.log(`${ok(gasOk)} Gas (native USDC, 18dp): ${formatEther(native)}${gasOk ? "" : "  → fund at faucet.circle.com (Arc Testnet)"}`);
    console.log(`${ok(usdcOk)} Spendable USDC (ERC-20, 6dp): ${formatUnits(usdc, 6)}${usdcOk ? "" : "  → fund at faucet.circle.com (Arc Testnet)"}`);
  } catch (e) {
    console.log(`❌ Could not reach Arc RPC (${config.rpcUrl}): ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Sources
const db = await getDb();
const sources = await db.listSources();
console.log(`${ok(sources.length > 0)} Registered sources: ${sources.length}`);

const ready = llm && !forcedOffline && gasOk && usdcOk && sources.length > 0;
console.log(line);
console.log(ready ? "🟢 READY for real settlement — run: npm run ask -- \"<question>\"" : "🟡 Not ready yet — resolve the ❌ items above.");
console.log(`   (faucet: https://faucet.circle.com/  ·  fund: ${config.funderKey ? privateKeyToAccount(config.funderKey as `0x${string}`).address : "<funder>"})\n`);
process.exit(0);
