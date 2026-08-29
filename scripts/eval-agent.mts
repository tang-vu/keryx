/** Hermetic quality/regression harness for the Keryx reasoning pipeline. */
import fs from "node:fs";
import path from "node:path";
import { HeuristicEngine } from "../lib/llm/heuristic-engine.ts";
import { getReasoningEngine } from "../lib/llm/index.ts";
import { AGENT_EVAL_CORPUS } from "../lib/evals/corpus.ts";
import { runAgentEvaluation } from "../lib/evals/runner.ts";
import { baselineFromReport, compareWithBaseline } from "../lib/evals/regression.ts";
import type { EvalBaseline } from "../lib/evals/types.ts";

const argv = process.argv.slice(2);
const value = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const has = (flag: string): boolean => argv.includes(flag);
const model = value("--model");
const caseId = value("--case");
const noBaseline = has("--no-baseline") || Boolean(caseId) || Boolean(model);
const writeBaseline = has("--write-baseline");
const jsonOnly = has("--json");
const engine = model ? getReasoningEngine(model) : new HeuristicEngine();
const cases = caseId ? AGENT_EVAL_CORPUS.filter((entry) => entry.id === caseId) : AGENT_EVAL_CORPUS;

if (caseId && cases.length === 0) {
  console.error(`Unknown evaluation case: ${caseId}`);
  process.exit(2);
}

if (!jsonOnly) console.log(`Keryx agent eval · ${engine.name} · ${cases.length} frozen case(s)`);
const report = await runAgentEvaluation({
  engine,
  cases,
  onCase: jsonOnly ? undefined : (id, index, total) => console.log(`  [${index + 1}/${total}] ${id}`),
});

const projectRoot = process.cwd();
const baselinePath = path.join(projectRoot, "evals", "baselines", "heuristic.json");
const artifactDir = path.join(projectRoot, ".artifacts", "evals");
fs.mkdirSync(artifactDir, { recursive: true });
const stamp = report.generatedAt.replace(/[:.]/g, "-");
const artifactPath = path.join(artifactDir, `${stamp}-${report.engine.replace(/[^a-z0-9._-]/gi, "-")}.json`);
fs.writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);

let regression = { passed: true, failures: [] as string[] };
if (writeBaseline) {
  if (model || caseId) {
    console.error("--write-baseline requires the complete default heuristic suite");
    process.exit(2);
  }
  if (!report.passed) {
    console.error("Refusing to write a baseline from a suite with hard safety failures");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(baselineFromReport(report), null, 2)}\n`);
} else if (!noBaseline) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8")) as EvalBaseline;
  regression = compareWithBaseline(report, baseline);
}

if (jsonOnly) {
  console.log(JSON.stringify({ report, regression }));
} else {
  console.log("");
  for (const result of report.cases) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`  ${status.padEnd(4)} ${result.caseId.padEnd(28)} ${result.score.toFixed(2)}`);
    for (const failure of result.hardFailures) console.log(`       safety: ${failure}`);
  }
  console.log(`\nScore ${report.score.toFixed(2)}/100 · ${report.hardFailureCount} safety failure(s)`);
  console.log(`Artifact: ${path.relative(projectRoot, artifactPath)}`);
  if (writeBaseline) console.log(`Baseline written: ${path.relative(projectRoot, baselinePath)}`);
  for (const failure of regression.failures) console.log(`Regression: ${failure}`);
}

if (!report.passed || !regression.passed) process.exit(1);
