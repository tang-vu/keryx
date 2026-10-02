/** Execute the actual minified Next server orchestrator with hermetic dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const build = path.resolve(process.env.NEXT_DIST_DIR || '.next');
const route = fs.readFileSync(path.join(build, 'server/app/api/ask/route.js'), 'utf8');
const runtime = require(path.join(build, 'server/chunks/[turbopack]_runtime.js'))('server/app/api/ask/route.js');
let agentId;
for (const match of route.matchAll(/R\.c\("([^"]+)"\)/g)) {
  runtime.c(match[1]);
  const registrations = require(path.join(build, match[1]));
  for (const registration of registrations) {
    if (typeof registration !== 'function') continue;
    const exported = registration.toString().match(/\.s\(\["runAgent",0,[^\]]+\],(\d+)\)/);
    if (exported) agentId = Number(exported[1]);
  }
}
assert(agentId, 'The production Ask route must contain the shared runAgent export');
const { runAgent } = runtime.m(agentId).exports;
assert.equal(typeof runAgent, 'function');
const forbidden = () => { throw new Error('No payment, synthesis or external effect is permitted'); };
async function check(withCandidates) {
  let readAttempts = 0;
  const engine = {
    name: 'heuristic', decompose: async () => ['approval binding'],
    decide: async ({ candidates }) => candidates.map(c => ({ sourceId: c.id, sourceName: c.name,
      action: 'BUY', expectedValue: 0.9, confidence: 0.9, price: 0, targets: [0], rationale: 'read original' })),
    synthesize: forbidden, sufficiency: forbidden, attribute: forbidden, reevaluate: forbidden,
  };
  const effects = { scope: { kind: 'public' }, getCached: async () => null, getCachedAt: async () => null,
    setCached: forbidden, recordPayment: forbidden, saveQueryRun: forbidden, discoverExternal: forbidden,
    decisionContext: async () => ({ memory: '', reputation: '' }), saveMemory: forbidden,
    notifyCitation: forbidden, alert: forbidden, activation: forbidden };
  const deps = { engine, effects, db: { listSources: async () => [], listPublicReferences: async () => [] },
    gateway: { mode: 'offline', ensureFunded: forbidden, payFetch: forbidden, payCitation: forbidden },
    webSearch: { search: async () => withCandidates ? [{ title: 'Original approval research',
      url: 'https://publisher.example/approval', snippet: 'Preview only, never evidence' }] : [] },
    readWebArticle: async () => { readAttempts++; throw new Error('Unavailable fixture page'); } };
  const generator = runAgent({ question: 'Research approval binding', budget: 0.05,
    researchMode: 'quick', origin: 'web' }, deps);
  const steps = [];
  let next = await generator.next();
  while (!next.done) { steps.push(next.value); next = await generator.next(); }
  const result = next.value;
  assert.equal(readAttempts, withCandidates ? 1 : 0);
  assert.equal(result.confidence.level, 'Low');
  assert.match(result.answer, /^No supported answer:/);
  assert.deepEqual(result.citations, []);
  assert.deepEqual(result.evidence, []);
  assert(result.claimCoverage.every(claim => claim.coverage === 0));
  assert.equal(result.totalSpent, 0);
  assert.equal(result.paymentAttempts, 0);
  assert.equal(result.trace.at(-1).phase, 'done');
}
(async () => { await check(false); await check(true);
  console.log('PASS: minified production run completes both no-source and failed-public-read branches with zero evidence/spend.');
})().catch(error => { console.error(error); process.exitCode = 1; });
