import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { artifact, renderStudy, type StudyArtifact } from "../lib/evals/paying-source-study/report";
import { canonical, parseCorpus, sha256 } from "../lib/evals/paying-source-study/contract";
import { denyOutbound, studyEnvironment } from "../lib/evals/paying-source-study/offline-boundary";

const root = fileURLToPath(new URL("../", import.meta.url));
const corpusPath = path.join(root, "fixtures/evals/studies/paying-source-corpus-v1.json");
const resultsPath = path.join(root, "fixtures/evals/studies/paying-source-results-v1.json");
const reportPath = path.join(root, "docs/studies/paying-for-sources-2026-10-09.md");
const args = process.argv.slice(2);
if (args.length !== 1 || !["--check", "--write", "--internal-worker"].includes(args[0]))
  throw new Error("Use --check or --write; no provider, private input or payment options are accepted");

function runtimeSources(): Record<string, string> {
  const files: string[] = [];
  function visit(directory: string) { for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(absolute);
    else if (entry.isFile() && /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) files.push(absolute);
  } }
  visit(path.join(root, "lib")); files.push(fileURLToPath(import.meta.url));
  return Object.fromEntries(files.map(file => [path.relative(root, file).replaceAll("\\", "/"), sha256(fs.readFileSync(file))]));
}
if (args[0] === "--internal-worker") {
  const boundary = denyOutbound();
  const corpus = parseCorpus(JSON.parse(fs.readFileSync(corpusPath, "utf8")));
  const { runStudy } = await import("../lib/evals/paying-source-study/runner");
  const trials = await runStudy(corpus);
  process.stdout.write(canonical(artifact(corpus, trials, runtimeSources(), sha256(fs.readFileSync(path.join(root, "package-lock.json"))), boundary.attempts())));
} else {
  const child = spawn(process.execPath, ["--import", "tsx", "--no-warnings", fileURLToPath(import.meta.url), "--internal-worker"],
    { cwd: root, env: studyEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  const chunks: Buffer[] = []; let bytes = 0; let stderr = ""; let failure: Error | undefined;
  const timer = setTimeout(() => { failure = new Error("Controlled study exceeded 120-second deadline"); child.kill("SIGKILL"); }, 120_000);
  child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length;
    if (bytes > 4 * 1024 * 1024) { failure = new Error("Controlled study exceeded output bound"); child.kill("SIGKILL"); }
    else chunks.push(chunk); });
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-8192); });
  child.on("error", error => { failure = error; });
  const code = await new Promise<number | null>(resolve => { child.once("close", resolve); child.once("error", () => resolve(null)); });
  clearTimeout(timer);
  if (failure || code !== 0) throw failure ?? new Error(`Controlled study worker failed (${code}): ${stderr}`);
  const bytesOut = Buffer.concat(chunks).toString("utf8");
  const result = JSON.parse(bytesOut) as StudyArtifact;
  const corpus = parseCorpus(JSON.parse(fs.readFileSync(corpusPath, "utf8")));
  if (result.trials.length !== 48 || result.outboundAttempts !== 0 || result.corpusSha256 !== sha256(canonical(corpus)))
    throw new Error("Controlled study artifact failed matrix boundary");
  const report = renderStudy(result, corpus);
  if (args[0] === "--write") {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(resultsPath, bytesOut); fs.writeFileSync(reportPath, report);
    console.log("Wrote 48 actual offline trials and generated study; no settled payments or outbound calls.");
  } else {
    if (fs.readFileSync(resultsPath, "utf8") !== bytesOut || fs.readFileSync(reportPath, "utf8") !== report)
      throw new Error("Study inputs/output/write-up drifted; inspect and reproduce with --write");
    console.log("Checked 48 actual offline trials: canonical outputs and write-up match exactly; outbound attempts 0.");
  }
}
