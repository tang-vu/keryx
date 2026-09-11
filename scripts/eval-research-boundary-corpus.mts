import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { RESEARCH_BOUNDARY_CORPUS } from "../lib/evals/research-boundary-corpus";
import { OpenAICompatibleEngine } from "../lib/llm/openai-compatible-engine";
import { buildEvidenceLedger } from "../lib/agent/evidence-ledger";

const { values } = parseArgs({ strict: true, options: { check: { type: "boolean" }, live: { type: "boolean" }, case: { type: "string" } } });
assert(!(values.check && values.live), "Use --check or --live");
assert.equal(new Set(RESEARCH_BOUNDARY_CORPUS.map(entry => entry.id)).size, RESEARCH_BOUNDARY_CORPUS.length);
for (const entry of RESEARCH_BOUNDARY_CORPUS) {
  assert(entry.question && entry.review.length && entry.gathered.length);
  assert.equal(new Set(entry.gathered.map(item => item.marker)).size, entry.gathered.length);
}
const cases = RESEARCH_BOUNDARY_CORPUS.filter(entry => !values.case || values.case === entry.id);
assert(cases.length, "Unknown case");
if (!values.live) {
  console.log(`${cases.length} English fictional boundary fixtures validated. --live calls the configured model; manual semantic review remains required.`);
  process.exit(0);
}
mkdirSync(".artifacts/evals", { recursive: true });
const artifact = `.artifacts/evals/boundary-corpus-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const results: unknown[] = [];
const save = () => writeFileSync(artifact, JSON.stringify({
  scope: "Model-only diagnostic using fictional documents. Planning, assessment, synthesis and evidence review; no discovery, purchase or settlement. Completion and model coverage are not semantic acceptance.",
  corpusSha256: createHash("sha256").update(JSON.stringify(cases)).digest("hex"), results,
}, null, 2));
try {
  for (const entry of cases) {
    const engine = new OpenAICompatibleEngine();
    const subClaims = await engine.decompose(entry.question);
    const gathered = [...entry.gathered], input = { question: entry.question, subClaims, gathered };
    const assessment = await engine.sufficiency(input), synthesis = await engine.synthesize(input);
    const ledger = buildEvidenceLedger({ subClaims, gathered, answer: synthesis.answer, declaredMarkers: synthesis.citedMarkers,
      proposedEvidence: synthesis.evidence, finalAssessment: assessment.perClaim });
    results.push({ ...entry, engine: engine.name, subClaims, assessment, synthesis,
      ledger: { ...ledger, acceptedMarkers: [...ledger.acceptedMarkers] }, usage: engine.usage });
    save(); console.log(JSON.stringify({ id: entry.id, state: "completed-needs-review" }));
  }
  console.log(`Saved ${artifact}; inspect prose and evidence against the review criteria. No automatic quality pass asserted.`);
} catch {
  save(); console.error(`Diagnostic stopped. Completed cases are retained in ${artifact}; no automatic retry.`); process.exitCode = 1;
}
