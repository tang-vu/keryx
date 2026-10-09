import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DeliverableInputError } from "../lib/evals/deliverable-contract";
import { deliverableFileFingerprint, loadDeliverableCorpus, readDeliverableFile } from "../lib/evals/deliverable-corpus";
import { buildRetainedQualityScorecard } from "../lib/evals/retained-quality-scorecard";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePaths = ["lib/evals/retained-quality-scorecard.ts", "lib/evals/deliverable-contract.ts",
  "lib/evals/deliverable-corpus.ts", "lib/research/bounded-portable-json.ts", "lib/llm/well-formed-utf16.ts",
  "scripts/compose-retained-quality-scorecard.mts", "scripts/fixtures/.gitattributes",
  "fixtures/evals/quality/.gitattributes", "fixtures/evals/quality/open-issues-20261009.json",
  "fixtures/evals/quality/coverage-v1.json", "package-lock.json"];
const parseCanonical = (bytes: Uint8Array) => {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), value: unknown = JSON.parse(text);
  if (JSON.stringify(value, null, 2) + "\n" !== text) throw new DeliverableInputError("NONCANONICAL_SCORECARD_INPUT");
  return value;
};
try {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--output" || args[1].startsWith("--")))
    throw new DeliverableInputError("UNSUPPORTED_SCORECARD_ARGUMENT");
  const files = sourcePaths.map(label => ({ label, file: path.join(root, label) }));
  const before = deliverableFileFingerprint(files);
  const corpus = loadDeliverableCorpus(path.join(root, "scripts/fixtures/deliverable-corpus-v1.json"));
  const inventory = parseCanonical(readDeliverableFile(path.join(root, "fixtures/evals/quality/open-issues-20261009.json")));
  const coverage = parseCanonical(readDeliverableFile(path.join(root, "fixtures/evals/quality/coverage-v1.json")));
  const env: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0" };
  for (const key of ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key];
  const git = spawnSync("git", ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"],
    { cwd: root, env, encoding: "utf8", timeout: 10000, maxBuffer: 4096 });
  if (git.error || git.signal || git.status !== 0 || !/^[a-f0-9]{40}$/.test(git.stdout.trim()))
    throw new DeliverableInputError("INSPECTOR_GIT_UNAVAILABLE");
  const report = buildRetainedQualityScorecard({ corpus, inventory, coverage, inspection: {
    inspectedAt: new Date().toISOString(), inspectorCommit: git.stdout.trim(),
    inspectorSourceSha256: before.sha256, runtime: process.version,
  } });
  const after = deliverableFileFingerprint(files);
  const reread = loadDeliverableCorpus(path.join(root, "scripts/fixtures/deliverable-corpus-v1.json"));
  if (before.sha256 !== after.sha256 || corpus.corpusSha256 !== reread.corpusSha256)
    throw new DeliverableInputError("SCORECARD_SOURCE_OR_INPUT_CHANGED");
  const result = { ...report, inspectorSourceFiles: before.files,
    sourceAttestation: "local-byte-fingerprint-and-recorded-HEAD-not-clean-Git-or-deployment",
    compositionCompleted: true, deterministicContractsPassed: report.overall.deterministicFailures === 0 };
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
  if (bytes.length > 4194304) throw new DeliverableInputError("SCORECARD_OUTPUT_TOO_LARGE");
  if (args.length) {
    const output = path.resolve(args[1]), fd = openSync(output, "wx", 0o600);
    try { let offset = 0; while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new DeliverableInputError("SCORECARD_OUTPUT_WRITE_FAILED");
      offset += written;
    } fsyncSync(fd); } finally { closeSync(fd); }
    if (!readFileSync(output).equals(bytes)) throw new DeliverableInputError("SCORECARD_OUTPUT_READBACK_FAILED");
  }
  process.stdout.write(bytes);
  // Exit0 is a completed composition, including its failures/UNJUDGED fields, never semantic acceptance.
} catch (error) {
  const code = error instanceof DeliverableInputError ? error.code : "LOCAL_SCORECARD_READ_OR_OUTPUT_FAILURE";
  process.stderr.write(JSON.stringify({ refused: true, code, operationalOrSemanticAcceptance: false }) + "\n");
  process.exitCode = 2;
}
