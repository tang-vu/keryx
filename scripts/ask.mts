/**
 * ask — run the Keryx agent over one question and print its full reasoning trace.
 * This is the "show me the agent's reasoning logs" view.
 *
 * Usage: npm run ask -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
 *        npm run ask -- "…" --model deepseek-v4-pro   (catalog id; see lib/llm/model-catalog.ts)
 *        npm run ask -- "…" --web   (explicit external search provider disclosure)
 */

import { c, printStep } from "./trace-console.mts";
import { formatRecordedUsdc } from "../lib/display/recorded-usdc.ts";

// ── parse args ──
const argv = process.argv.slice(2);
let budget: number | undefined;
let model: string | undefined;
let allowExternalWeb = false;
const qParts: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--budget") {
    const value = argv[++i];
    if (!value || !/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value) || !Number.isFinite(Number(value)))
      throw new Error("--budget requires a finite nonnegative decimal USDC value with at most six decimal places.");
    budget = Number(value);
  } else if (argv[i] === "--model") {
    const value = argv[++i];
    if (!value?.trim() || value.startsWith("-") || /[\u0000-\u001f\u007f]/u.test(value))
      throw new Error("--model requires a nonempty model id.");
    model = value.trim();
  } else if (argv[i] === "--web") {
    allowExternalWeb = true;
  } else if (argv[i].startsWith("--")) {
    throw new Error("Unsupported option. Review-first requires the authenticated live browser.");
  } else {
    qParts.push(argv[i]);
  }
}
const question =
  qParts.join(" ").trim() ||
  "How do x402 and stablecoin micropayments enable autonomous AI agent commerce?";

// Refuse unsupported execution intent before initializing the agent/provider graph.
const [{ collectRun }, { getReasoningEngine }, { ResearchPlanningError, researchFailureMessage },
  { ResearchSelectionError }, { reasoningOutputLimitText }] = await Promise.all([
  import("../lib/agent/index.ts"), import("../lib/llm/index.ts"), import("../lib/llm/research-plan.ts"),
  import("../lib/llm/research-selection.ts"), import("../lib/llm/reasoning-telemetry.ts"),
]);

console.log(c.bold(`\n🏛  Keryx — citation-toll reading agent`));
console.log(`${c.dim("engine:")} ${getReasoningEngine(model).name}`);
console.log(`${c.dim("source cap:")} ${budget ?? 0.05} USDC`);
console.log(`${c.dim("question:")} ${question}\n`);
if (allowExternalWeb) console.log("Public web search may send this question to the configured search provider. The source USDC budget is separate from model and search operating costs.");
console.log(c.dim("─".repeat(72)));

const run = await collectRun({ question, budget, model, origin: "engine", allowExternalWeb,
  provenance: { version: 1, surface: "cli", ownershipMethod: "unknown" } }, { onStep: printStep }).catch(error => {
  if (!(error instanceof ResearchPlanningError) && !(error instanceof ResearchSelectionError)) throw error;
  console.error(researchFailureMessage(error));
  if (error instanceof ResearchSelectionError) console.error(JSON.stringify({ selectionDiagnostic: error.diagnostic }));
  process.exit(1);
});

console.log(c.dim("─".repeat(72)));
console.log(c.bold("\n📝 Answer\n"));
console.log(run.answer);
const outputLimit = reasoningOutputLimitText(run.reasoningAttempts, /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(question) ? "vi" : "en", run.trace);
if (outputLimit) console.log(`\n${outputLimit}`);

console.log(c.bold("\n💸 Planned citation allocations (USDC)"));
if (run.citations.length === 0) {
  console.log(c.dim("  (no citation allocations)"));
} else {
  for (const cit of run.citations) {
    console.log(
      `  • ${cit.sourceName}: ${c.green(formatRecordedUsdc(cit.reward, { denomination: "USDC" }))} ${c.dim(`(${(cit.weight * 100).toFixed(0)}% contribution)`)}`,
    );
  }
}

console.log(
  c.bold(`\n📊 Recorded source total: ${c.green(formatRecordedUsdc(run.totalSpent, { denomination: "USDC" }))}`) +
    c.dim(`  ·  ${run.decisions.filter((d) => d.action === "BUY").length} bought / ${run.decisions.filter((d) => d.action === "SKIP").length} skipped`),
);
console.log(c.dim(`Payment mode: ${run.paymentMode === "offline" ? "offline simulation" : run.paymentMode ?? "unknown"}. Allocations and recorded totals do not prove settlement; inspect the original per-payment receipts.`));
console.log(c.dim("Model and search operating costs are separate from the source cap and recorded source total."));
if (run.operatingFee) console.log(`Keryx operating fee allocation: ${formatRecordedUsdc(run.operatingFee.amountUsdc, { denomination: "USDC" })} · ${run.operatingFee.status}. Separate from creator rewards; inspect the original payment ledger for settlement evidence.`);
console.log(c.dim(`\nrun id: ${run.id}\n`));
process.exit(0);
