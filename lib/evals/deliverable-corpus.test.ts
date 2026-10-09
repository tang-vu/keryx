import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { deliverableFileFingerprint, gradeDeliverableCorpus, loadDeliverableCorpus, readDeliverableFile } from "./deliverable-corpus";

const root = fileURLToPath(new URL("../../", import.meta.url));
const corpusPath = path.join(root, "scripts/fixtures/deliverable-corpus-v1.json");
const temporary: string[] = [];
function directory() { const dir = mkdtempSync(path.join(tmpdir(), "keryx-deliverable-test-")); temporary.push(dir); return dir; }
function copiedCorpus() {
  const dir = directory(), manifest = JSON.parse(readFileSync(corpusPath, "utf8"));
  for (const entry of manifest.cases) writeFileSync(path.join(dir, entry.file), readFileSync(path.join(path.dirname(corpusPath), entry.file)));
  const file = path.join(dir, "corpus.json"); writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  return { dir, file, manifest };
}
afterEach(() => {
  for (const dir of temporary.splice(0)) {
    if (path.dirname(path.resolve(dir)) !== path.resolve(tmpdir()) || !path.basename(dir).startsWith("keryx-deliverable-test-"))
      throw new Error("Unexpected test cleanup path");
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("SHA-bound public corpus", () => {
  it("reports two real retained format failures and explicitly incomplete issue-class coverage", () => {
    const corpus = loadDeliverableCorpus(corpusPath), result = gradeDeliverableCorpus(corpus);
    expect(result.caseCount).toBe(2);
    expect(result.deterministicFailures).toBe(2);
    expect(result.deterministicPassRate).toBe(0);
    expect(result.acceptedDeliverableRate).toBeNull();
    expect(result.coverage).toEqual({ coveredClasses: ["single-page"],
      missingClasses: ["exact-metadata", "comparison", "teaching-note", "newest-release"], completeOpenIssueCoverage: false });
    expect(result.gradingCalls).toEqual({ provider: 0, search: 0, payment: 0, database: 0 });
    expect(corpus.corpusSha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects a byte changed in a fixture, a missing file and an empty corpus", () => {
    const { dir, file, manifest } = copiedCorpus();
    writeFileSync(path.join(dir, manifest.cases[0].file), "{}");
    expect(() => loadDeliverableCorpus(file)).toThrow("FIXTURE_DIGEST_MISMATCH");
    manifest.cases[0].file = "deliverable-missing.json"; writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    expect(() => loadDeliverableCorpus(file)).toThrow();
    manifest.cases = []; writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
  });
  it("rejects duplicate cases/files and path escape names", () => {
    const { file, manifest } = copiedCorpus();
    manifest.cases.push(manifest.cases[0]); writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    expect(() => loadDeliverableCorpus(file)).toThrow("DUPLICATE_CORPUS_CASE");
    manifest.cases.pop(); manifest.cases[0].file = "../secret.json"; writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
    expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
  });
  it("rejects invalid UTF8/JSON, directories and oversized regular files", () => {
    const dir = directory(), file = path.join(dir, "input.json");
    writeFileSync(file, Buffer.from([0xff])); expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
    writeFileSync(file, "{"); expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
    expect(() => readDeliverableFile(dir)).toThrow("UNSUPPORTED_OR_OVERSIZED_FILE");
    writeFileSync(file, "a".repeat(98305)); expect(() => readDeliverableFile(file)).toThrow("UNSUPPORTED_OR_OVERSIZED_FILE");
  });
  it("rejects duplicate JSON keys and noncanonical byte forms instead of silently normalizing them", () => {
    const { file } = copiedCorpus();
    const text = readFileSync(file, "utf8");
    writeFileSync(file, text.replace('"version": 1,', '"version": 1,\n  "version": 1,'));
    expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
    writeFileSync(file, text.trim());
    expect(() => loadDeliverableCorpus(file)).toThrow("INVALID_CORPUS_MANIFEST");
  });
  it("source fingerprints change with actual bytes, not only file names or sizes", () => {
    const dir = directory(), file = path.join(dir, "source.ts"), inputs = [{ label: "source.ts", file }];
    writeFileSync(file, "one"); const before = deliverableFileFingerprint(inputs);
    writeFileSync(file, "two"); expect(deliverableFileFingerprint(inputs).sha256).not.toBe(before.sha256);
  });
});

describe("standalone CLI with no operational dependencies", () => {
  function run(args: string[]) {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "test" };
    for (const key of ["PATH", "SYSTEMROOT", "TEMP", "TMP"]) if (process.env[key]) env[key] = process.env[key]!;
    return spawnSync(process.execPath, ["--import", "tsx", "scripts/grade-retained-deliverables.mts", ...args],
      { cwd: root, env, encoding: "utf8", timeout: 10000, maxBuffer: 1048576 });
  }
  it("validation exit0 preserves failing grades; ordinary grading exit1 never reports accepted deliverables", () => {
    const validation = run(["--validate-corpus"]);
    expect(validation.error).toBeUndefined(); expect(validation.signal).toBeNull(); expect(validation.status).toBe(0);
    const report = JSON.parse(validation.stdout);
    expect(report).toMatchObject({ corpusValid: true, outcome: "FAIL", deterministicFailures: 2, operationalOrSemanticAcceptance: false });
    expect(report.graderSource.sha256).toMatch(/^[a-f0-9]{64}$/);
    const grading = run([]); expect(grading.error).toBeUndefined(); expect(grading.signal).toBeNull(); expect(grading.status).toBe(1);
    expect(JSON.parse(grading.stdout).acceptedDeliverables).toBe(0);
  });
  it("refuses missing input/unknown or duplicate flags and never overwrites an output", () => {
    for (const args of [["--corpus"], ["--live"], ["--validate-corpus", "--validate-corpus"]]) {
      const result = run(args); expect(result.error).toBeUndefined(); expect(result.status).toBe(2);
      expect(result.stdout).toBe(""); expect(JSON.parse(result.stderr).refused).toBe(true);
    }
    const output = path.join(directory(), "retained.json"); writeFileSync(output, "preserve");
    const refused = run(["--validate-corpus", "--output", output]);
    expect(refused.status).toBe(2); expect(readFileSync(output, "utf8")).toBe("preserve");
  });
});
