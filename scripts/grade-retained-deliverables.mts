import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DeliverableInputError } from "../lib/evals/deliverable-contract";
import { deliverableFileFingerprint, gradeDeliverableCorpus, loadDeliverableCorpus } from "../lib/evals/deliverable-corpus";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePaths = ["lib/evals/deliverable-contract.ts", "lib/evals/deliverable-corpus.ts",
  "scripts/grade-retained-deliverables.mts", "scripts/fixtures/.gitattributes", "lib/research/bounded-portable-json.ts",
  "lib/llm/well-formed-utf16.ts", "package-lock.json"];
try {
  const args = process.argv.slice(2);
  let manifestPath = path.join(root, "scripts/fixtures/deliverable-corpus-v1.json");
  let output: string | undefined, validateOnly = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (seen.has(arg)) throw new DeliverableInputError("DUPLICATE_ARGUMENT");
    seen.add(arg);
    if (arg === "--validate-corpus") validateOnly = true;
    else if ((arg === "--corpus" || arg === "--output") && args[index + 1] && !args[index + 1].startsWith("--")) {
      const value = path.resolve(args[++index]);
      if (arg === "--corpus") manifestPath = value; else output = value;
    } else throw new DeliverableInputError("UNSUPPORTED_ARGUMENT");
  }
  const inputs = sourcePaths.map(label => ({ label, file: path.join(root, label) }));
  const before = deliverableFileFingerprint(inputs);
  const corpus = loadDeliverableCorpus(manifestPath);
  const report = gradeDeliverableCorpus(corpus);
  const after = deliverableFileFingerprint(inputs);
  const reread = loadDeliverableCorpus(manifestPath);
  if (before.sha256 !== after.sha256 || corpus.corpusSha256 !== reread.corpusSha256)
    throw new DeliverableInputError("SOURCE_OR_CORPUS_CHANGED");
  const result = { ...report, graderSource: before, runtime: process.version,
    mode: validateOnly ? "validate-corpus-and-report-measurements" : "grade-recorded-contracts",
    corpusValid: true, operationalOrSemanticAcceptance: false };
  const bytes = JSON.stringify(result, null, 2) + "\n";
  if (output) writeFileSync(output, bytes, { encoding: "utf8", flag: "wx" });
  process.stdout.write(bytes);
  // Validation mode verifies fixture integrity only. Neither exit0 nor a structural pass is semantic acceptance.
  process.exitCode = validateOnly ? 0 : 1;
} catch (error) {
  const code = error instanceof DeliverableInputError ? error.code : "LOCAL_READ_OR_OUTPUT_FAILURE";
  process.stderr.write(JSON.stringify({ refused: true, code, operationalOrSemanticAcceptance: false }) + "\n");
  process.exitCode = 2;
}
