/** First-party model diagnostic including real planning; no discovery or payment calls. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ingestRssXml } from '../lib/ingest/rss';
import { OpenAICompatibleEngine } from '../lib/llm/openai-compatible-engine';
import { buildEvidenceLedger } from '../lib/agent/evidence-ledger';
import { evidenceContext } from '../lib/llm/evidence-context';

const args = process.argv.slice(2);
assert(args.every(arg => ['--check', '--live'].includes(arg)) && !(args.includes('--check') && args.includes('--live')), 'Use --check or --live');
const feed = await ingestRssXml(readFileSync('docs/engineering/feed.xml', 'utf8'), 'https://raw.githubusercontent.com/tang-vu/keryx/main/docs/engineering/feed.xml');
const gathered = feed.items.map((item, i) => ({ sourceId: `engineering-${i}`, sourceName: 'Keryx Engineering (first-party)', marker: `S${i + 1}`, text: item.content, itemTitle: item.title }));
const cases = [
  { id: 'recovery-repeat', question: 'How does the Keryx buyer journal a job before submission, and how can it recover after losing the response without paying again? Use the Keryx Engineering source for the documented behavior.', expected: 'Two supported information needs; no separate source-instruction target.', empty: false },
  { id: 'receipt-and-missing-sql', question: 'How does Keryx verify a research receipt, and which SQL isolation level does its buyer journal use?', expected: 'Retain receipt verification and SQL isolation. Verification is supported; the SQL isolation level is not documented and must stay unsupported.', empty: false },
  { id: 'payment-versus-finality', question: 'What is the difference between an access toll and a citation reward, and does a Circle transfer reference prove on-chain finality?', expected: 'Explain the two payment legs and the explicit negative finality answer. Do not assert chain finality.', empty: false },
  { id: 'missing-performance', question: 'What percentage of Keryx jobs from external customers succeeded last month, and what was their p95 latency?', expected: 'Neither external cohort measurement exists in this corpus. Do not substitute provisional package targets for measured latency or first-party results for external usage.', empty: false },
  { id: 'empty-recovery', question: 'How can the Keryx buyer recover a paid research job without paying again?', expected: 'No supplied sources, hence no evidence-qualified answer or reward-eligible evidence.', empty: true },
];
assert.equal(cases.length, new Set(cases.map(entry => entry.id)).size);
assert.equal(gathered.length, 2);
assert(gathered.some(source => source.text.includes('Before signing, the journal records')));
if (!args.includes('--live')) {
  console.log('Five English fixtures checked. --live runs two rounds, up to 40 direct model requests, and needs manual semantic review.');
  process.exit(0);
}

mkdirSync('.artifacts/evals', { recursive: true });
const artifact = `.artifacts/evals/english-pipeline-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const results: unknown[] = [];
try {
  for (let round = 1; round <= 2; round++) {
    for (const entry of cases) {
      const engine = new OpenAICompatibleEngine();
      const sources = entry.empty ? [] : gathered;
      const subClaims = await engine.decompose(entry.question);
      const input = { question: entry.question, subClaims, gathered: sources };
      const assessment = await engine.sufficiency(input);
      const synthesis = await engine.synthesize(input);
      const ledger = buildEvidenceLedger({ subClaims, gathered: sources, answer: synthesis.answer, declaredMarkers: synthesis.citedMarkers, proposedEvidence: synthesis.evidence, finalAssessment: assessment.perClaim });
      results.push({ ...entry, round, model: engine.name, corpusSha256: createHash('sha256').update(JSON.stringify(sources)).digest('hex'), subClaims, context: evidenceContext(entry.question, subClaims, sources), assessment, synthesis, claimCoverage: ledger.claimCoverage, evidence: ledger.evidence, usage: engine.usage });
      writeFileSync(artifact, JSON.stringify({ scope: 'Ten model-only runs on two first-party articles or empty input. Real planning, assessment, synthesis/review and evidence ledger; no discovery, purchase, settlement or automatic semantic pass assertion.', results }, null, 2));
      console.log(JSON.stringify({ id: entry.id, round, targets: subClaims, coverage: ledger.claimCoverage.map(claim => claim.coverage), evidence: ledger.evidence.length }));
    }
  }
  console.log(`Saved ${artifact}. Review targets, prose and evidence against expectations; exit zero only means the diagnostic completed.`);
} catch {
  console.error(`Diagnostic stopped; completed rows, if any, are saved in ${artifact}. No automatic retry or reasoning fallback.`);
  process.exitCode = 1;
}
