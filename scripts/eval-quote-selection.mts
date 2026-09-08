/** Opt-in model experiment, not a paid pilot or a CI quality gate. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ingestRssXml } from '../lib/ingest/rss';
import { OpenAICompatibleEngine } from '../lib/llm/openai-compatible-engine';
import { buildEvidenceLedger } from '../lib/agent/evidence-ledger';
import { evidenceContext } from '../lib/llm/evidence-context';
import { buildQuoteOptions } from '../lib/llm/quote-options';

const args = process.argv.slice(2);
if (args.some(arg => !['--live', '--check'].includes(arg)) || (args.includes('--live') && args.includes('--check'))) {
  throw new Error('Usage: node --import tsx scripts/eval-quote-selection.mts [--check | --live]');
}
const expectedQuote = 'Before signing, the journal records the normalized request, payment terms, nonce and deterministic job identifier.';

class Experiment extends OpenAICompatibleEngine {
  originalEvidence: unknown;
  constructor(private variant: boolean) { super(); }
  protected async chatJson(model: string, system: string, user: string, maxTokens?: number) {
    const data = JSON.parse(user);
    if (this.variant && data.quoteOptions) {
      system += ' First select evidence for each research question in its given order. Output the evidence array before writing the answer. Then write only what those selected quotations support; do not choose quotations merely to decorate a prewritten answer.';
      data.schema = '{"evidence":[{"claimIndex":number,"marker":string,"quoteId":string,"support":number(0..1)}],"answer":string (markdown with [S#] citations),"citedMarkers":string[],"conflicts":[{"point":string,"positions":[{"marker":string,"stance":string}],"trusted":string,"reason":string}]}';
    }
    const out = await super.chatJson(model, system, JSON.stringify(data), maxTokens);
    if (data.quoteOptions) this.originalEvidence = out.evidence;
    return out;
  }
}
const feed = await ingestRssXml(readFileSync('docs/engineering/feed.xml','utf8'), 'https://raw.githubusercontent.com/tang-vu/keryx/main/docs/engineering/feed.xml');
const gathered = feed.items.map((item,i) => ({sourceId:`engineering-${i}`,sourceName:'Keryx Engineering (first-party)',marker:`S${i+1}`,text:item.content,itemTitle:item.title}));
const subClaims = ['How does the buyer preserve the original job before submission?', 'What does resume do after response loss, and what payment actions does it avoid?'];
const question = 'How can a Keryx buyer recover a job after losing the submission response without paying again?';
const options = buildQuoteOptions(evidenceContext(question, subClaims, gathered));
const expected = options.find(option => option.marker === 'S2' && option.text === expectedQuote);
if (!expected) throw new Error('The pre-submission journal evidence is missing from the model quote menu.');
if (!args.includes('--live')) {
  console.log('Fixture check passed: the original journaling sentence is available as an exact quote option. No model calls.');
  process.exit(0);
}
// Direct engine: provider failures are failures, never relabelled heuristic fallback.
// No agent runner, database, source registration, wallet or payment gateway is used.
const artifactDir = '.artifacts/evals';
mkdirSync(artifactDir, { recursive: true });
const artifactPath = `${artifactDir}/quote-selection-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const results: unknown[] = [];
const corpusSha256 = createHash('sha256').update(JSON.stringify(gathered)).digest('hex');
try {
for (let repeat = 0; repeat < 3; repeat++) {
  for (const variant of [false,true]) {
    const engine = new Experiment(variant);
    const assessment = await engine.sufficiency({question,subClaims,gathered});
    const synthesis = await engine.synthesize({question,subClaims,gathered});
    const ledger = buildEvidenceLedger({subClaims,gathered,answer:synthesis.answer,declaredMarkers:synthesis.citedMarkers,proposedEvidence:synthesis.evidence,finalAssessment:assessment.perClaim});
    const row = {repeat,variant:variant?'evidence-first':'baseline',model:engine.name,
      selectedExpectedQuote: synthesis.evidence.some(item => item.claimIndex === 0 && item.quote === expectedQuote),
      originalEvidence: engine.originalEvidence,
      coverage:ledger.claimCoverage.map(c=>c.coverage),synthesis};
    results.push(row);
    writeFileSync(artifactPath,JSON.stringify({scope:'First-party corpus, direct model calls, no payment; six runs, up to eighteen model requests. Scores are not independent verification.',corpusSha256,question,subClaims,expectedQuote,expectedQuoteId:expected.quoteId,results},null,2));
    console.log(JSON.stringify({repeat,variant:row.variant,selectedExpectedQuote:row.selectedExpectedQuote,coverage:row.coverage}));
  }
}
console.log(`Saved ${artifactPath}`);
} catch {
  // Provider error bodies can contain sensitive request context. Preserve completed rows only.
  console.error(`Model evaluation failed; completed rows, if any, are in ${artifactPath}`);
  process.exitCode = 1;
}
