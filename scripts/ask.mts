/**
 * ask — run the Keryx agent over one question and print its full reasoning trace.
 * This is the "show me the agent's reasoning logs" view.
 *
 * Usage: npm run ask -- "How do x402 and stablecoins enable AI agent commerce?" --budget 0.05
 *        npm run ask -- --help
 *        npm run ask -- "…" --model deepseek-v4-pro   (catalog id; see lib/llm/model-catalog.ts)
 *        npm run ask -- "…" --web   (explicit external search provider disclosure)
 * Private claims require a direct Node launcher with a dedicated inherited pipe; see private-cli-claims-262.md.
 */

import { c, printStep } from "./trace-console.mts";
import { formatRecordedUsdc, formatNumber } from "../lib/i18n/format.ts";
import { projectActualReadCheckpoints } from "../lib/research-audit/actual-read-projection.ts";
import { parsePrivateCliClaimFd, preparePrivateCliClaim } from "./private-cli-claims.mts";
import { clientPresentationLanguage, clientPresentationMessages } from "../shared/i18n/client-language.ts";
import { recordedAnswerLanguage } from "../lib/research/answer-language-provenance.ts";

// ── parse args ──
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Usage: npm run ask -- [options] "question"

Options:
  --help, -h                Show help without starting research or contacting providers.
  --budget USDC             Nonnegative source cap, at most six decimal places.
  --model ID                Override the configured reasoning model.
  --web                     Allow configured external web/search providers.
  --language LANGUAGE       Presentation labels: auto, en, vi, pt, pt-BR, es, fr or zh-Hans.
  --private-claim-fd FD      Dedicated inherited private pipe; direct Node launcher only.

Without a question, the existing sample question is used.
Model and search operating costs are separate from the source cap.
Private claim setup: docs/engineering/private-cli-claims-262.md`);
  process.exit(0);
}
let budget: number | undefined;
let model: string | undefined;
let allowExternalWeb = false;
let privateClaimFd: number | undefined;
let languageOverride: string | undefined;
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
  } else if (argv[i] === "--language") {
    if (languageOverride !== undefined) throw new Error("Duplicate presentation language option.");
    languageOverride = argv[++i];
    if (!languageOverride || languageOverride.startsWith("-")) throw new Error("--language requires en, vi, pt, pt-BR, es, fr, zh-Hans or auto.");
    clientPresentationLanguage(undefined, languageOverride);
  } else if (argv[i] === "--web") {
    allowExternalWeb = true;
  } else if (argv[i] === "--private-claim-fd") {
    if (privateClaimFd !== undefined) throw new Error("Duplicate private claim output option.");
    privateClaimFd = parsePrivateCliClaimFd(argv[++i]);
  } else if (argv[i].startsWith("--")) {
    throw new Error("Unsupported option. Review-first requires the authenticated live browser.");
  } else {
    qParts.push(argv[i]);
  }
}
const question =
  qParts.join(" ").trim() ||
  "How do x402 and stablecoin micropayments enable autonomous AI agent commerce?";
const clientLanguage = clientPresentationLanguage(Intl.DateTimeFormat().resolvedOptions().locale, languageOverride);

// Refuse unsupported execution intent before initializing the agent/provider graph.
const privateClaim = await preparePrivateCliClaim({ env: process.env, fd: privateClaimFd, prepare: async runId => {
  const { prepareHostedRunClaim } = await import("../lib/run-claims/hosted-delivery.ts");
  return prepareHostedRunClaim(runId);
} });
const [{ collectRun }, { getReasoningEngine }, { ResearchPlanningError, researchFailureMessage },
  { ResearchSelectionError }, { reasoningOutputLimitText }] = await Promise.all([
  import("../lib/agent/index.ts"), import("../lib/llm/index.ts"), import("../lib/llm/research-plan.ts"),
  import("../lib/llm/research-selection.ts"), import("../lib/llm/reasoning-telemetry.ts"),
]);

const clientCopy = clientPresentationMessages(clientLanguage);
console.log(c.bold(`\n🏛  Keryx — citation-toll reading agent`));
console.log(`${c.dim(`${clientCopy.controls.engine}:`)} ${getReasoningEngine(model).name}`);
console.log(`${c.dim(`${clientCopy.controls.sourceCap}:`)} ${budget ?? 0.05} USDC`);
console.log(`${c.dim(`${clientCopy.controls.question}:`)} ${question}\n`);
if (allowExternalWeb) console.log("Public web search may send this question to the configured search provider. The source USDC budget is separate from model and search operating costs.");
console.log(c.dim("─".repeat(72)));

const run = await collectRun({ question, budget, model, origin: "engine", allowExternalWeb,
  ...(privateClaim ? { queryId: privateClaim.queryId } : {}),
  provenance: { version: 1, surface: "cli", ownershipMethod: "unknown" } }, { onStep: printStep }).catch(error => {
  if (!(error instanceof ResearchPlanningError) && !(error instanceof ResearchSelectionError)) throw error;
  console.error(researchFailureMessage(error));
  if (error instanceof ResearchSelectionError) console.error(JSON.stringify({ selectionDiagnostic: error.diagnostic }));
  process.exit(1);
});
// collectRun returns only after saving the original. The packet never joins this run or its trace.
const privateClaimStatus = await privateClaim?.complete(run);

console.log(c.dim("─".repeat(72)));
const answerLanguage = recordedAnswerLanguage(run) ?? clientLanguage;
const resultCopy = clientPresentationMessages(answerLanguage);
console.log(c.bold(`\n📝 ${resultCopy.controls.answer}\n`));
console.log(run.answer);
const readCheckpoints = projectActualReadCheckpoints(run);
console.log(readCheckpoints ? `READ checkpoint assertions retained: ${readCheckpoints.retainedDigest}. Verify the downloaded report sidecar offline with research-audit verify-actual; this does not prove source authenticity or settlement.`
  : "READ checkpoint evidence unavailable; historical/private/native runs are not reconstructed.");
const outputLimit = reasoningOutputLimitText(run.reasoningAttempts, /[ăâđêôơưĂÂĐÊÔƠƯ\u1ea0-\u1ef9]/u.test(question) ? "vi" : "en", run.trace);
if (outputLimit) console.log(`\n${outputLimit}`);

console.log(c.bold("\n💸 Planned citation allocations (USDC)"));
if (run.citations.length === 0) {
  console.log(c.dim("  (no citation allocations)"));
} else {
  for (const cit of run.citations) {
    console.log(
      `  • ${cit.sourceName}: ${c.green(formatRecordedUsdc(cit.reward, { denomination: "USDC" }))} ${c.dim(`(${formatNumber(cit.weight * 100, { maximumFractionDigits: 0 })}% contribution)`)}`,
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
console.log(c.dim(`\n${resultCopy.controls.runId}: ${run.id}\n`));
if (privateClaimStatus === "written") console.log(c.dim("Private account claim written once to the dedicated private pipe. Keep it private; lost delivery cannot be reissued."));
if (privateClaimStatus === "unavailable") console.log(c.dim("The completed answer is saved, but its private account claim is unavailable. Do not repeat paid research to recover it."));
process.exit(0);
