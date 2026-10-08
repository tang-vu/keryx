/** Actual minified reader -> gathered source -> context -> quote boundaries.
 * No fetch, model, payment or persistence; only inert local HTML worker input.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { findExportModuleIds } = require('./test-built-empty-evidence.cjs');

async function main() {
  let fetchAttempts = 0;
  globalThis.fetch = async () => { fetchAttempts++; throw new Error('External requests are forbidden'); };
  const build = path.resolve(process.env.NEXT_DIST_DIR || '.next');
  const routeDirectory = path.join(build, 'server/app/api/ask');
  const trace = JSON.parse(fs.readFileSync(path.join(routeDirectory, 'route.js.nft.json'), 'utf8'));
  const runtime = require(path.join(build, 'server/chunks/[turbopack]_runtime.js'))('server/app/api/ask/route.js');
  const names = ['extractHtml', 'gatheredArticle', 'JsonChatEngine', 'sourceHtmlLayout'];
  const ids = new Map(names.map(name => [name, new Set()]));
  // Reasoning providers load lazily; inspect only this Ask route's traced chunk
  // closure, not unrelated page bundles or a separately transpiled source copy.
  const chunks = trace.files.map(file => path.resolve(routeDirectory, file)).filter(file =>
    file.startsWith(path.join(build, 'server/chunks') + path.sep) && file.endsWith('.js') && !file.endsWith('[turbopack]_runtime.js'));
  for (const chunk of chunks) {
    runtime.c(path.relative(build, chunk));
    const registrations = require(chunk);
    for (const name of names) for (const id of findExportModuleIds(registrations, name)) ids.get(name).add(id);
  }
  const functions = {};
  for (const name of names) {
    assert.equal(ids.get(name).size, 1, `Expected exactly one ${name} export in the built Ask route`);
    functions[name] = (await runtime.m([...ids.get(name)][0]).exports)[name];
    assert.equal(typeof functions[name], 'function');
  }
  const { extractHtml, gatheredArticle, JsonChatEngine, sourceHtmlLayout } = functions;
  const padding = 'Background context without the requested operational terms. '.repeat(60);
  const quote = 'If delimiters enclose a value, an embedded delimiter is escaped\n  by placing a second delimiter immediately before it.';
  const facts = 'The satellite rotates at the same rate as it circles the planet, so the same hemisphere faces the planet.';
  const light = 'The far hemisphere receives sunlight during part of its orbit; calling it always dark is misleading.';
  const html = `<main><h1>Original document</h1><a>Orbit and Rotation</a><p>${padding}</p>` +
    `<pre>${quote}\n\n  "sample""example"</pre><p>${padding}</p>` +
    `<h3>Orbit and Rotation</h3><p>${facts}</p><p>${light}</p><p>${padding}</p></main>`;
  const article = await extractHtml(html, 'https://example.com/original');
  const source = { ...gatheredArticle('public:web:fixture', article), marker: 'S1' };
  assert(sourceHtmlLayout(source), 'Observed worker layout must retain identity across built modules');
  assert.equal(sourceHtmlLayout(JSON.parse(JSON.stringify(source))), undefined, 'JSON cannot restore enrollment');
  assert.equal(sourceHtmlLayout({ ...source, text: source.text.replace('escaped', 'changed') }), undefined);
  assert.equal(sourceHtmlLayout({ ...source, contentVersion: 'changed-version' }), undefined);
  const payloads = [];
  class CaptureEngine extends JsonChatEngine {
    name = 'synthetic-capture';
    async chatJson(_model, _system, user) { payloads.push(JSON.parse(user)); return {}; }
  }
  const engine = new CaptureEngine();
  const input = { question: 'En español, explique "Orbit and Rotation" y cómo se escapa un delimitador.',
    subClaims: ['escaped embedded delimiter', '¿Por qué vemos el mismo hemisferio?'], gathered: [source] };
  await engine.sufficiency(input);
  await engine.reevaluate({ ...input, skippedSources: [], remainingBudget: 0 });
  await engine.synthesize(input);
  assert.equal(payloads.length, 3);
  const requested = payloads[0].gathered;
  assert.deepEqual(requested, payloads[1].gathered);
  assert.deepEqual(requested, payloads[2].sources);
  assert(requested[0].passages.some(passage => passage.text.includes(facts) && passage.text.includes(light)));
  assert(requested[0].passages.reduce((sum, passage) => sum + passage.text.length, 0) <= 2000);
  const wrapped = engine.synthesisQuoteOptions(input, requested).find(option => option.text === quote);
  assert(wrapped, 'Wrapped quote must preserve its enclosing condition through actual built source boundaries');
  assert.equal(source.text.slice(wrapped.start, wrapped.end), quote);
  assert.equal(source.text.slice(wrapped.contextStart, wrapped.contextEnd), wrapped.context);
  assert(wrapped.context.includes('"sample""example"'));
  assert.equal(fetchAttempts, 0);
  console.log('PASS: minified worker enrollment, exact body/version binding, named heading prose and complete wrapped quotes; no network/model/payment.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
