/**
 * ask — run the Keryx agent over one question and print its full reasoning trace.
 * This is the "show me the agent's reasoning logs" view.
 *
 * Usage: npm run ask -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
 */

import { collectRun } from "../lib/agent/index.ts";
import { getReasoningEngine } from "../lib/llm/index.ts";
import type { TraceStep } from "../lib/types.ts";

// ── parse args ──
const argv = process.argv.slice(2);
let budget: number | undefined;
const qParts: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--budget" && argv[i + 1]) {
    budget = parseFloat(argv[++i]);
  } else {
    qParts.push(argv[i]);
  }
}
const question =
  qParts.join(" ").trim() ||
  "How do x402 and stablecoin micropayments enable autonomous AI agent commerce?";

// ── colors ──
const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[39m`,
  green: (s: string) => `\x1b[32m${s}\x1b[39m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[39m`,
  red: (s: string) => `\x1b[31m${s}\x1b[39m`,
  magenta: (s: string) => `\x1b[35m${s}\x1b[39m`,
};

const phaseColor: Record<string, (s: string) => string> = {
  decompose: c.cyan,
  discover: c.cyan,
  decide: c.yellow,
  fetch: c.green,
  sufficiency: c.magenta,
  synthesize: c.cyan,
  attribute: c.magenta,
  settle: c.green,
  done: c.bold,
};

function printStep(s: TraceStep) {
  const tag = (phaseColor[s.phase] ?? c.dim)(`[${s.phase}]`.padEnd(14));
  console.log(`${tag} ${s.message}`);
}

console.log(c.bold(`\n🏛  Keryx — citation-toll reading agent`));
console.log(`${c.dim("engine:")} ${getReasoningEngine().name}`);
console.log(`${c.dim("budget:")} $${budget ?? 0.05}`);
console.log(`${c.dim("question:")} ${question}\n`);
console.log(c.dim("─".repeat(72)));

const run = await collectRun({ question, budget }, { onStep: printStep });

console.log(c.dim("─".repeat(72)));
console.log(c.bold("\n📝 Answer\n"));
console.log(run.answer);

console.log(c.bold("\n💸 Creators paid"));
if (run.citations.length === 0) {
  console.log(c.dim("  (no citations settled)"));
} else {
  for (const cit of run.citations) {
    console.log(
      `  • ${cit.sourceName}: ${c.green("$" + cit.reward)} ${c.dim(`(${(cit.weight * 100).toFixed(0)}% contribution)`)}`,
    );
  }
}

console.log(
  c.bold(`\n📊 Total spent: ${c.green("$" + run.totalSpent)}`) +
    c.dim(`  →  100% to creators  ·  ${run.decisions.filter((d) => d.action === "BUY").length} bought / ${run.decisions.filter((d) => d.action === "SKIP").length} skipped`),
);
console.log(c.dim(`\nrun id: ${run.id}\n`));
process.exit(0);
