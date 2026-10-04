/** Execute the actual minified Next server orchestrator with hermetic dependencies. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

/** Read Turbopack's compressed [id, ...ids, factory] registrations without executing factories.
 * ESM bindings encode [name, 0, value] or [name, getter, optionalSetter]; strings in values are
 * not export names. Concatenated factories can pass an explicit module ID to context.s(). */
function findExportModuleIds(registrations, exportName) {
  const found = new Set();
  let moduleIds = [];
  const callable = node => ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isIdentifier(node);
  for (const registration of registrations) {
    if (typeof registration !== 'function') {
      assert(['number', 'string'].includes(typeof registration), 'Unsupported Turbopack module ID');
      moduleIds.push(registration);
      continue;
    }
    assert(moduleIds.length, 'Turbopack factory has no registered module ID');
    const source = ts.createSourceFile('factory.js', `(${registration.toString()})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0, 'Cannot parse Turbopack module factory');
    function visit(node) {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 's') {
        const bindings = node.arguments[0];
        if (bindings && ts.isArrayLiteralExpression(bindings) && bindings.elements.some(item => ts.isStringLiteral(item) && item.text === exportName)) {
          let exportsTarget = false;
          for (let index = 0; index < bindings.elements.length;) {
            const name = bindings.elements[index++], binding = bindings.elements[index++];
            assert(name && ts.isStringLiteral(name) && binding, 'Unsupported Turbopack export binding');
            if (ts.isNumericLiteral(binding)) {
              assert(Number(binding.text) === 0 && index < bindings.elements.length, 'Unsupported Turbopack value binding');
              index++; // Skip the value, including any string that happens to equal exportName.
            } else {
              assert(callable(binding), 'Unsupported Turbopack getter binding');
              const setter = bindings.elements[index];
              if (setter && !ts.isStringLiteral(setter)) {
                assert(callable(setter), 'Unsupported Turbopack setter binding');
                index++;
              }
            }
            exportsTarget ||= name.text === exportName;
          }
          if (exportsTarget) {
            const explicitId = node.arguments[1];
            if (!explicitId || explicitId.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(explicitId) && explicitId.text === 'undefined')) {
              for (const id of moduleIds) found.add(id);
            } else {
              assert(ts.isNumericLiteral(explicitId) || ts.isStringLiteral(explicitId), 'Unsupported Turbopack explicit module ID');
              const id = ts.isNumericLiteral(explicitId) ? Number(explicitId.text) : explicitId.text;
              assert(moduleIds.includes(id), 'Turbopack export ID is not registered by this factory');
              found.add(id);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    moduleIds = [];
  }
  assert.equal(moduleIds.length, 0, 'Turbopack registration has no factory');
  return [...found];
}

let runAgent;
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
async function main() {
  const build = path.resolve(process.env.NEXT_DIST_DIR || '.next');
  const route = fs.readFileSync(path.join(build, 'server/app/api/ask/route.js'), 'utf8');
  const runtime = require(path.join(build, 'server/chunks/[turbopack]_runtime.js'))('server/app/api/ask/route.js');
  const agentIds = new Set();
  for (const match of route.matchAll(/R\.c\("([^"]+)"\)/g)) {
    runtime.c(match[1]);
    for (const id of findExportModuleIds(require(path.join(build, match[1])), 'runAgent')) agentIds.add(id);
  }
  assert.equal(agentIds.size, 1, `Expected one shared runAgent export in the production Ask route; found ${agentIds.size}`);
  // An async dependency makes Turbopack expose this module's exports as a promise.
  ({ runAgent } = await runtime.m([...agentIds][0]).exports);
  assert.equal(typeof runAgent, 'function');
  await check(false); await check(true);
  console.log('PASS: minified production run completes both no-source and failed-public-read branches with zero evidence/spend.');
}

module.exports = { findExportModuleIds };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
