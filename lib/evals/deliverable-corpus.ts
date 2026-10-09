import { lstatSync, openSync, readSync, closeSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { boundedPortableCopy } from "../research/bounded-portable-json";
import { deliverableContractSchema, DeliverableInputError, deliverableSha256, gradeDeliverable,
  MAX_DELIVERABLE_BYTES, validateDeliverableInputs } from "./deliverable-contract";

const manifestSchema = z.object({
  version: z.literal(1), id: z.string().regex(/^[a-z0-9-]{1,64}$/),
  description: z.string().min(1).max(1024),
  cases: z.array(z.object({ file: z.string().regex(/^deliverable-[a-z0-9-]+\.json$/),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), contract: deliverableContractSchema }).strict()).min(1).max(32),
}).strict();
const ALL_CLASSES = ["single-page", "exact-metadata", "comparison", "teaching-note", "newest-release"];

/** Capped local regular-file read. No URLs, directory recursion, retry or environment loading. */
export function readDeliverableFile(file: string, maximum = MAX_DELIVERABLE_BYTES): Uint8Array {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum)
    throw new DeliverableInputError("UNSUPPORTED_OR_OVERSIZED_FILE");
  const descriptor = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(maximum + 1);
    let length = 0;
    while (length <= maximum) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (!read) return buffer.subarray(0, length);
      length += read;
    }
    throw new DeliverableInputError("OVERSIZED_FILE");
  } finally { closeSync(descriptor); }
}
function parseJson(bytes: Uint8Array): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(text);
    // Reviewed corpus files use this one byte form. Duplicate keys and hidden trailing
    // data cannot be normalized into an apparently valid parsed object.
    if (JSON.stringify(value, null, 2) + "\n" !== text) throw new Error();
    return value;
  }
  catch { throw new DeliverableInputError("INVALID_UTF8_OR_JSON"); }
}
export function loadDeliverableCorpus(manifestPath: string) {
  const manifestBytes = readDeliverableFile(manifestPath);
  let manifest: z.infer<typeof manifestSchema>;
  try { manifest = manifestSchema.parse(boundedPortableCopy(parseJson(manifestBytes), MAX_DELIVERABLE_BYTES)); }
  catch { throw new DeliverableInputError("INVALID_CORPUS_MANIFEST"); }
  const ids = manifest.cases.map(entry => entry.contract.id), files = manifest.cases.map(entry => entry.file);
  if (new Set(ids).size !== ids.length || new Set(files).size !== files.length)
    throw new DeliverableInputError("DUPLICATE_CORPUS_CASE");
  const cases = manifest.cases.map(entry => {
    const bytes = readDeliverableFile(path.join(path.dirname(manifestPath), entry.file));
    if (deliverableSha256(bytes) !== entry.sha256) throw new DeliverableInputError("FIXTURE_DIGEST_MISMATCH");
    const snapshotInput = parseJson(bytes);
    const validated = validateDeliverableInputs(entry.contract, snapshotInput);
    return { ...entry, snapshot: validated.snapshot };
  });
  return { manifest, cases, corpusSha256: deliverableSha256(manifestBytes) };
}
export function gradeDeliverableCorpus(corpus: ReturnType<typeof loadDeliverableCorpus>) {
  const cases = corpus.cases.map(entry => ({ fixtureSha256: entry.sha256,
    ...gradeDeliverable(entry.contract, entry.snapshot) }));
  const failed = cases.filter(entry => !entry.deterministicContractPassed).length;
  const coveredClasses = [...new Set(cases.map(entry => entry.kind))];
  return { version: 1, corpusId: corpus.manifest.id, corpusSha256: corpus.corpusSha256,
    scope: "retained-public-snapshot-inspection", collection: "no-new-agent-run",
    gradingCalls: { provider: 0, search: 0, payment: 0, database: 0 },
    caseCount: cases.length, deterministicFailures: failed,
    deterministicPassRate: (cases.length - failed) / cases.length,
    acceptedDeliverables: 0, acceptedDeliverableRate: null,
    outcome: failed ? "FAIL" : "UNJUDGED",
    coverage: { coveredClasses, missingClasses: ALL_CLASSES.filter(kind => !coveredClasses.includes(kind as typeof coveredClasses[number])),
      completeOpenIssueCoverage: false },
    cases };
}

/** Source files and dependency lock are hashed before/after inspection; no Git cleanliness claim. */
export function deliverableFileFingerprint(files: { label: string; file: string }[]) {
  const rows = files.map(entry => ({ path: entry.label, sha256: deliverableSha256(readDeliverableFile(entry.file, 4194304)) }));
  return { sha256: deliverableSha256(JSON.stringify(rows)), files: rows };
}
