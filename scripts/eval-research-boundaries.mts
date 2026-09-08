/** First-party coverage diagnostics. Offline fixture validation by default; opt-in model use. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { ingestRssXml } from '../lib/ingest/rss';
import { OpenAICompatibleEngine } from '../lib/llm/openai-compatible-engine';
import { buildEvidenceLedger, MIN_REWARD_SUPPORT } from '../lib/agent/evidence-ledger';

const args = process.argv.slice(2);
assert(args.every(arg => ['--check', '--live'].includes(arg)) && !(args.includes('--check') && args.includes('--live')), 'Use --check or --live');
const feed = await ingestRssXml(readFileSync('docs/engineering/feed.xml','utf8'), 'https://raw.githubusercontent.com/tang-vu/keryx/main/docs/engineering/feed.xml');
const gathered = feed.items.map((item,i) => ({sourceId:`engineering-${i}`, sourceName:'Keryx Engineering (first-party)', marker:`S${i+1}`, text:item.content, itemTitle:item.title}));
const buyer = gathered.find(source => source.text.includes('Before signing, the journal records'));
assert(buyer, 'Expected dated buyer article');
const cases = [
  {id:'receipt-binding', question:'How does the buyer bind a research receipt to the original request and retain later receipt updates?',
    targets:['How is receipt integrity and binding to the original question and answer checked?', 'How are changed receipt snapshots retained?'], supported:[true,true], gathered},
  {id:'settlement-limit', question:'Does a completed research job or a Circle transfer reference prove on-chain finality?',
    targets:['Does a completed job establish adequate evidence coverage?', 'Does a Circle transfer reference establish completed on-chain batch finality?'], supported:[true,true], gathered},
  {id:'absent-database-detail', question:'Which SQL database table and transaction isolation level does the buyer job journal use?',
    targets:['Which SQL database table stores the buyer job journal?', 'Which transaction isolation level does the buyer journal use?'], supported:[false,false], gathered},
  {id:'title-only-recovery', question:'How does the buyer preserve the original job before submission?',
    targets:['How does the buyer preserve the original job before submission?'], supported:[false],
    gathered:[{...buyer, text:'Recovering a Keryx paid research job. Published September 8, 2026 by Keryx.'}]},
  {id:'empty-corpus', question:'How does the buyer preserve the original job before submission?',
    targets:['How does the buyer preserve the original job before submission?'], supported:[false], gathered:[]},
];
assert(cases.every(entry => entry.targets.length === entry.supported.length));
assert.equal(new Set(cases.map(entry => entry.id)).size,cases.length);
assert(gathered.some(source => source.text.includes('canonical SHA-256 digest')));
assert(gathered.some(source => source.text.includes('not automatically an explorer transaction hash')));
if (!args.includes('--live')) {
  console.log(`${cases.length} fixture cases checked; no model calls. Support labels describe answerability, including explicit negative answers.`);
  process.exit(0);
}

const engine = new OpenAICompatibleEngine();
const results: unknown[] = [];
mkdirSync('.artifacts/evals',{recursive:true});
const artifact = `.artifacts/evals/research-boundaries-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;
let failures = 0;
try {
  for (const entry of cases) {
    const input = {question:entry.question,subClaims:entry.targets,gathered:entry.gathered};
    const assessment = await engine.sufficiency(input);
    const synthesis = await engine.synthesize(input);
    const ledger = buildEvidenceLedger({subClaims:entry.targets,gathered:entry.gathered,answer:synthesis.answer,
      declaredMarkers:synthesis.citedMarkers,proposedEvidence:synthesis.evidence,finalAssessment:assessment.perClaim});
    const checks = entry.targets.map((target,index) => {
      const coverage = ledger.claimCoverage[index]?.coverage ?? 0;
      const assessed = assessment.perClaim?.[index]?.coverage ?? 0;
      const passes = entry.supported[index] ? coverage>=MIN_REWARD_SUPPORT
        : coverage<MIN_REWARD_SUPPORT && assessed<MIN_REWARD_SUPPORT && !ledger.evidence.some(e=>e.claimIndex===index && e.qualifiesForReward);
      return {target,expectedAnswerable:entry.supported[index],coverage,assessed,passes};
    });
    const passed = checks.every(check => check.passes);
    if (!passed) failures++;
    results.push({id:entry.id,question:entry.question,corpusSha256:createHash('sha256').update(JSON.stringify(entry.gathered)).digest('hex'),checks,assessment,synthesis,passed});
    writeFileSync(artifact,JSON.stringify({scope:'Five first-party model-only cases, up to fifteen direct model requests, no fallback, source purchase or payment. Threshold checks do not independently verify answer prose.',model:engine.name,results},null,2));
    console.log(JSON.stringify({id:entry.id,passed,coverage:checks.map(check=>check.coverage),assessed:checks.map(check=>check.assessed)}));
  }
  console.log(`Saved ${artifact}; ${failures} case(s) outside expected coverage boundaries.`);
  if (failures) process.exitCode=1;
} catch {
  console.error(`Evaluation failed; completed rows, if any, are in ${artifact}`);
  process.exitCode=1;
}
