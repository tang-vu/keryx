/** No .env loader: public reads and heuristic replay are opt-in operations in an isolated DB. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { INTERNAL_RESEARCH_INPUTS } from "../lib/evals/internal-research-inputs.ts";
import { executeResearchWorkload, workloadSnapshotHash, workloadSourceUrl, type WorkloadRead } from "../lib/evals/research-workload.ts";
import { HeuristicEngine } from "../lib/llm/heuristic-engine.ts";
import { articleFailureCode, readArticle } from "../lib/web-research/article-reader.ts";
import { extractPdfText } from "../lib/web-research/pdf-reader.ts";
import { BoundedWorkloadEngine, WorkloadModelBudget } from "../lib/evals/bounded-workload-engine.ts";
import { createWorkloadPdfFixtures } from "../lib/evals/workload-pdf-fixtures.ts";

const args = process.argv.slice(2);
const value = (flag: string) => args[args.indexOf(flag) + 1];
const capture = args.includes("--capture");
const replay = args.includes("--replay");
const live = args.includes("--live");
if (capture === replay) throw new Error("Choose --capture (public source reads) or --replay (no network)");
if (live && !replay) throw new Error("--live requires --replay of retained public/fictional snapshots");
const selected = INTERNAL_RESEARCH_INPUTS.filter(row => (!args.includes("--case") || value("--case").split(",").includes(row.id)) &&
  (!args.includes("--fixtures") || row.inputKind !== "public-original"));
if (!selected.length) throw new Error("Unknown task id");
const root = path.resolve(".artifacts/workload-research");
const snapshots = path.join(root, "reads");
await mkdir(snapshots, { recursive: true });
// Explicit key-only intake; never copy the production environment into this harness.
const apiKey = live ? (args.includes("--key-file") ? parseEnv(await readFile(value("--key-file"), "utf8")).DEEPSEEK_API_KEY : process.env.DEEPSEEK_API_KEY) : undefined;
if (live && !apiKey) throw new Error("Live execution requires an authorized DeepSeek key");
const mode = live ? "live-model" : "heuristic";
const attempt = new Date().toISOString().replaceAll(/[:.]/g, "-");
if (capture) {
  await mkdir(".artifacts/workload-inputs", { recursive: true });
  for (const fixture of createWorkloadPdfFixtures()) await writeFile(path.join(".artifacts/workload-inputs", fixture.filename), fixture.bytes);
}
const observed = new Map<string, WorkloadRead>();
let requests = 0;
const report: unknown[] = [];
let failed = false;
const allowance = live ? new WorkloadModelBudget(path.join(root, "live-budget.json")) : undefined;
try {
for (const input of selected) {
  const snapshotFile = path.join(snapshots, `${input.id}.json`);
  if (capture) {
    const reads: WorkloadRead[] = [];
    for (const [index, source] of input.sources.entries()) {
      const url = workloadSourceUrl(input, index);
      const row: WorkloadRead = { url, title: source.title, observedAt: new Date().toISOString(), provenance: input.inputKind,
        observedScope: source.observedScope };
      try {
        if (source.fixture?.artifactPath) {
          const bytes = await readFile(source.fixture.artifactPath);
          const extracted = await extractPdfText(bytes, { maxPages: 20, maxChars: 60000, timeoutMs: 5000 });
          row.article = { text: extracted.text, title: source.title, finalUrl: url, kind: "pdf", truncated: extracted.truncated };
        } else if (source.text) {
          row.article = { text: source.text, title: source.title, finalUrl: url, kind: "text", truncated: source.fixture?.truncated ?? false };
        } else if (source.url) {
          const previous = observed.get(url);
          if (previous) { reads.push(structuredClone(previous)); continue; }
          if (++requests > 40) throw new Error("Read allowance exceeded");
          row.article = await readArticle(url);
        } else throw new Error("No source input");
        row.snapshotSha256 = workloadSnapshotHash(row.article);
      } catch (error) {
        row.failure = source.fixture?.artifactPath ? "pdf-extraction-unavailable" : articleFailureCode(error);
      }
      observed.set(url, row);
      reads.push(row);
    }
    await writeFile(snapshotFile, JSON.stringify(reads, null, 2));
    console.log(JSON.stringify({ id: input.id, captured: reads.filter(row => row.article).length, failed: reads.filter(row => !row.article).length }));
  } else {
    const reads = JSON.parse(await readFile(snapshotFile, "utf8")) as WorkloadRead[];
    const engine = live ? new BoundedWorkloadEngine(apiKey!, allowance!) : new HeuristicEngine();
    try {
      const result = await executeResearchWorkload(input, reads, engine);
      const dir = path.join(root, mode, attempt, input.id);
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "run.json"), JSON.stringify(result.run, null, 2));
      await writeFile(path.join(dir, "receipt.json"), JSON.stringify(result.receipt, null, 2));
      await writeFile(path.join(dir, "report.md"), result.markdown);
      await writeFile(path.join(dir, "evidence.csv"), result.exports.evidenceCsv);
      await writeFile(path.join(dir, "references.bib"), result.exports.bibtex.content);
      await writeFile(path.join(dir, "references.ris"), result.exports.ris.content);
      await writeFile(path.join(dir, "observation.json"), JSON.stringify(result.observation, null, 2));
      await writeFile(path.join(dir, "capture-manifest.json"), JSON.stringify(reads.map(({ article, ...row }) => ({ ...row,
        finalUrl: article?.finalUrl, kind: article?.kind, truncated: article?.truncated })), null, 2));
      report.push(result.observation);
      failed ||= result.observation.hardFailures.length > 0;
      console.log(JSON.stringify({ id: input.id, completed: true, readAttempts: result.observation.readAttempts.length,
        citations: result.observation.citedSources, hardFailures: result.observation.hardFailures }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "";
      const failure = /exceeded? \d+ (bounded )?targets/.test(detail) ? "research-target-limit" : detail.includes("snapshot integrity") ? "capture-integrity-failed"
        : detail.includes("allowance") ? "model-allowance-unavailable" : "execution-failed";
      failed = true; report.push({ id: input.id, pipelineCompleted: false, failure,
        diagnostic: detail.slice(0, 200), calls: "calls" in engine ? engine.calls : [], usage: "usage" in engine ? engine.usage : [] });
      console.log(`${input.id}: ${failure}`);
    }
  }
}
if (replay) await writeFile(path.join(root, `${mode}-summary-${attempt}.json`), JSON.stringify({ generatedAt: new Date().toISOString(),
  scope: "isolated-supplied-candidate-workload", taskCount: selected.length, passedSafety: !failed,
  allowance: allowance?.snapshot(), cases: report }, null, 2));
if (failed) process.exitCode = 1;
} finally { allowance?.close(); }
