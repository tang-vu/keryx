/**
 * demo-full-cycle — the one-command money-shot. Runs ONE question end-to-end on Arc testnet
 * (decide → pay x402 toll → read → synthesize → settle weighted citation rewards) and prints
 * HONEST on-chain proof: the wallet addresses whose USDC balances actually moved.
 *
 * Real settlement needs testnet config (ANTHROPIC_API_KEY + AGENT_FUNDER_PRIVATE_KEY +
 * NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS). Without it the SAME flow runs offline and is clearly
 * labeled SIMULATED — no on-chain links are printed (a mock is never presented as settled).
 *
 * Per-payment settlement IDs are Circle batch UUIDs (off-chain ledger), NOT EVM tx hashes, so
 * proof is the USDC balance change at the wallet addresses below — not per-payment /tx/ links.
 *
 * Usage: npm run demo -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
 */

import { collectRun, getAgentDeps } from "../lib/agent/index.ts";
import { config } from "../lib/config.ts";
import { c, printStep } from "./trace-console.mts";

// ── parse args (mirrors ask.mts) ──
const argv = process.argv.slice(2);
let budget: number | undefined;
const qParts: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--budget" && argv[i + 1]) budget = parseFloat(argv[++i]);
  else qParts.push(argv[i]);
}
const question =
  qParts.join(" ").trim() ||
  "How do x402 and stablecoin micropayments enable autonomous AI agent commerce?";
const b = budget ?? config.defaultBudget;

const EXPLORER = config.explorerUrl;
const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

// ── header ──
const deps = await getAgentDeps();
const real = deps.gateway.mode === "real";
console.log(c.bold(`\n🏛  Keryx — full-cycle demo`));
console.log(`${c.dim("engine:")}   ${deps.engine.name}`);
console.log(
  `${c.dim("mode:")}     ${real ? c.green("REAL · settles on Arc testnet") : c.yellow("SIMULATED · offline (no funder/LLM key)")}`,
);
console.log(`${c.dim("budget:")}   $${b}`);
console.log(`${c.dim("question:")} ${question}\n`);
console.log(c.dim("─".repeat(72)));

const t0 = Date.now();

// Pre-fund so we can surface the (EVM) Gateway deposit tx as extra proof. Idempotent: the
// agent's own ensureFunded() then sees a sufficient balance and skips re-depositing.
let depositTx: string | undefined;
if (real) {
  try {
    depositTx = (await deps.gateway.ensureFunded(b)).depositTx;
  } catch (e) {
    console.log(
      c.red(`\n⚠ Funding failed: ${(e as Error).message}`) +
        c.dim(`\n   Check AGENT_FUNDER_PRIVATE_KEY balance on Arc testnet (faucet: https://faucet.circle.com).`),
    );
    process.exit(1);
  }
}

const run = await collectRun({ question, budget: b }, { deps, onStep: printStep });
const elapsed = ((Date.now() - t0) / 1000).toFixed(0);

console.log(c.dim("─".repeat(72)));
console.log(c.bold("\n📝 Answer\n"));
console.log(run.answer);

// ── settled payments → honest on-chain proof ──
const payments = await deps.db.listPaymentsByQuery(run.id);
const settled = payments.filter((p) => p.settled);

console.log(c.bold(`\n💸 Creators paid (${settled.length} settled)`));
if (settled.length === 0) {
  console.log(c.dim("  (no citations settled)"));
} else {
  // group by payee so a source's fetch toll + citation reward collapse into one line
  const byPayee = new Map<string, { name: string; total: number }>();
  for (const p of settled) {
    const cur = byPayee.get(p.payee.toLowerCase()) ?? { name: p.sourceName, total: 0 };
    cur.total += p.amountUsdc;
    byPayee.set(p.payee.toLowerCase(), cur);
  }
  for (const v of byPayee.values()) {
    console.log(`  • ${v.name} ${c.green("+$" + v.total.toFixed(6))}`);
  }
}

console.log(
  c.bold(`\n📊 Spent $${run.totalSpent}`) +
    c.dim(
      `  →  $${run.totalToCreators} to creators  ·  ` +
        `${run.decisions.filter((d) => d.action === "BUY").length} bought / ` +
        `${run.decisions.filter((d) => d.action === "SKIP").length} skipped  ·  ⏱ ${elapsed}s`,
    ),
);

// ── proof footer ──
if (real && settled.length > 0) {
  console.log(c.bold(`\n🔗 On-chain proof — Arc testnet (${EXPLORER})`));
  console.log(`  ${c.dim("agent spend wallet")}  ${addrUrl(deps.gateway.agentAddress())}  ${c.dim("(USDC out)")}`);
  if (depositTx) console.log(`  ${c.dim("gateway deposit tx")}  ${txUrl(depositTx)}  ${c.dim("(EVM fund step)")}`);
  if (config.registryAddress) {
    console.log(`  ${c.dim("source registry   ")}  ${addrUrl(config.registryAddress)}  ${c.dim("(sources on-chain)")}`);
  }
  const seen = new Set<string>();
  for (const p of settled) {
    if (seen.has(p.payee.toLowerCase())) continue;
    seen.add(p.payee.toLowerCase());
    console.log(`  ${c.dim("creator paid      ")}  ${addrUrl(p.payee)}  ${c.dim("(" + p.sourceName + ")")}`);
  }
  console.log(
    c.dim(
      "\n  ℹ Per-payment settlement IDs are Circle batch UUIDs (off-chain ledger), not EVM tx hashes.\n" +
        "    The verifiable proof is the USDC balance change at the wallet addresses above.",
    ),
  );
} else if (!real) {
  console.log(c.yellow(`\n⚠ SIMULATED — nothing settled on-chain.`));
  console.log(
    c.dim(`  Set ANTHROPIC_API_KEY + AGENT_FUNDER_PRIVATE_KEY + NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS to settle for real.`),
  );
}

console.log(c.dim(`\nrun id: ${run.id}  ·  permalink: ${config.baseUrl}/dispatch/${run.id}\n`));
process.exit(0);
