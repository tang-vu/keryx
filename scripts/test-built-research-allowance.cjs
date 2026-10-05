/** Verify the actual minified Ask graph with protected local fixtures and synthetic HTTP only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { findExportModuleIds } = require('./test-built-empty-evidence.cjs');
const ts = require('typescript');

const hash = value => createHash('sha256').update(value).digest('hex');
const now = '2026-10-05T12:00:00.000Z';
const questions = ['First synthetic compiled question?', 'Second synthetic compiled question?', 'Third synthetic compiled question?'];
const prefix = 'keryx-built-research-allowance-';

function protectedFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.chmodSync(root, 0o700);
  const journalDirectory = path.join(root, 'journal');
  fs.mkdirSync(journalDirectory, { mode: 0o700 });
  const policy = {
    format: 'keryx-production-research-allowance-v2', policyId: 'keryx-live-browser-2026-10-05-v2',
    priceCheckedOn: '2026-10-05', pricePolicyId: 'deepseek-flash-reviewed-2026-10-05-v1',
    modelEvidenceSha256: '210f102275ccf1a6542f08a3bc9e4b4c7c83278cb74b35217bffa112df6363b2',
    provider: 'deepseek', endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-v4-flash',
    expiresAt: '2026-10-05T23:59:59.000Z', maximumMicroUsd: 1000000, maximumCalls: 46,
    maximumInputBytes: 32000, maximumOutputTokens: 8192, journalDirectory,
    search: { provider: 'tavily', endpoint: 'https://api.tavily.com/search',
      pricePolicyId: 'tavily-basic-reviewed-2026-10-05-v1',
      evidenceSha256: '3b21fe9c9c0ba44a0662551d9d247f98277a9cc70d242a8ada91309dba829b83',
      searchDepth: 'basic', maximumCalls: 6, reservePerCallMicroUsd: 8000 },
    research: { origin: 'web', mode: 'quick', sourceBudgetMicroUsdc: 0, maximumQuestions: 3,
      maximumSearchCallsPerQuestion: 2, questionSha256: questions.map(hash) },
  };
  const file = path.join(root, 'policy.json');
  const bytes = JSON.stringify(policy);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return { root, journalDirectory, file, digest: hash(bytes) };
}

/** Resolve every requested export from registrations loaded by this one Ask route runtime. */
async function productionGraph(build, names) {
  const route = fs.readFileSync(path.join(build, 'server/app/api/ask/route.js'), 'utf8');
  const runtime = require(path.join(build, 'server/chunks/[turbopack]_runtime.js'))('server/app/api/ask/route.js');
  const ids = new Map(names.map(name => [name, new Set()]));
  const configFactories = new Set();
  const chunks = [...route.matchAll(/R\.c\("([^"]+)"\)/g)].map(match => match[1]);
  assert(chunks.length > 0, 'Ask route has no recognized production chunk registrations');
  for (const chunk of chunks) {
    runtime.c(chunk);
    const registrations = require(path.join(build, chunk));
    for (const name of names) for (const id of findExportModuleIds(registrations, name)) ids.get(name).add(id);
    let registered = [];
    for (const registration of registrations) {
      if (typeof registration !== 'function') { registered.push(registration); continue; }
      if (findExportModuleIds([...registered, registration], 'config').length) configFactories.add(registration);
      registered = [];
    }
  }
  // Next may tree-shake unused browser registry getters. Read only literal PUBLIC pins from
  // config's actual compiled initializer, never private values or an application .env file.
  const pinValues = new Map(['NEXT_PUBLIC_KERYX_NETWORK', 'NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS',
    'NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'].map(name => [name, new Set()]));
  for (const factory of configFactories) {
    const source = ts.createSourceFile('config.js', `(${factory.toString()})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length, 0);
    function visit(node) {
      if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
          pinValues.has(node.name.text) && ts.isStringLiteral(node.initializer)) pinValues.get(node.name.text).add(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  const pins = {};
  for (const [name, values] of pinValues) {
    assert(values.size <= 1, `Ambiguous compiled public pin ${name}`);
    if (values.size) pins[name] = [...values][0];
  }
  const exported = async name => {
    assert(ids.has(name), 'Export is outside the inspected Ask graph');
    const selected = [...ids.get(name)];
    assert.equal(selected.length, 1, `Expected one ${name} export in the Ask graph; found ${selected.length}`);
    const value = (await runtime.m(selected[0]).exports)[name];
    assert(value, `Missing compiled ${name} export`);
    return value;
  };
  return { exported, pins };
}

async function main() {
  if (process.platform === 'win32') {
    console.log('SKIP: compiled allowance acceptance requires real POSIX directory fsync; Linux acceptance remains required.');
    return;
  }
  const OriginalDate = Date, originalFetch = globalThis.fetch;
  const previous = new Map();
  const env = (name, value) => { previous.set(name, process.env[name]); process.env[name] = value; };
  let fixture;
  const calls = { model: 0, search: 0, forbidden: 0 };
  const holds = kind => fs.readdirSync(fixture.journalDirectory).filter(name => name.startsWith(`${kind}-`));
  const forbidden = () => { calls.forbidden++; throw Error('No payment, source read or external effect is permitted in compiled acceptance'); };
  try {
    globalThis.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : [now])); }
      static now() { return OriginalDate.parse(now); }
    };
    fixture = protectedFixture();
    env('KERYX_MODEL_ALLOWANCE_FILE', fixture.file); env('KERYX_MODEL_ALLOWANCE_SHA256', fixture.digest);
    env('DEEPSEEK_API_KEY', 'synthetic-compiled-model-key');
    env('KERYX_WEB_SEARCH_PROVIDER', 'tavily'); env('TAVILY_API_KEY', 'synthetic-compiled-search-key');
    globalThis.fetch = async (url, init) => {
      assert.equal(holds('question').length, 1, 'Question must be durable before HTTP');
      const body = JSON.parse(init.body);
      assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
      if (url === 'https://api.tavily.com/search') {
        calls.search++;
        assert.equal(init.headers.Authorization, 'Bearer synthetic-compiled-search-key');
        assert.equal(holds('search').length, calls.search, 'Search hold must precede HTTP');
        assert.deepEqual(body, { query: calls.search === 1 ? questions[0] : 'Reviewed compiled target',
          search_depth: 'basic', topic: 'general', auto_parameters: false, include_answer: false,
          include_raw_content: false, include_images: false, max_results: 10 });
        return Response.json({ results: [{ url: 'https://example.com/synthetic-compiled-source',
          title: 'Synthetic unverified preview', content: 'A preview is not source evidence.' }] });
      }
      assert.equal(url, 'https://api.deepseek.com/chat/completions', 'Unapproved HTTP request refused');
      calls.model++;
      assert.equal(init.headers.Authorization, 'Bearer synthetic-compiled-model-key');
      assert.equal(body.model, 'deepseek-v4-flash');
      assert.equal(holds('model').length, calls.model, 'Model hold must precede HTTP');
      assert(Number.isInteger(body.max_tokens) && body.max_tokens <= 8192);
      const content = calls.model === 1 ? { claims: ['Reviewed compiled target'] }
        : { decisions: JSON.parse(body.messages[1].content).candidates.map(candidate => ({ sourceId: candidate.sourceId,
          action: 'SKIP', expectedValue: 0, confidence: 0.8, rationale: 'No original evidence selected', targets: [] })) };
      return Response.json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] });
    };
    const build = path.resolve(process.env.NEXT_DIST_DIR || '.next');
    const { exported, pins } = await productionGraph(build, ['runAgent', 'getReasoningEngine', 'config', 'tavilyProvider', 'browserPaymentProfile']);
    // Match the build's PUBLIC network/registry pins without reading any application environment
    // or custody file. This supports both the no-secret testnet CI build and mainnet builds.
    const profile = (await exported('browserPaymentProfile'))();
    if (pins.NEXT_PUBLIC_KERYX_NETWORK) assert.equal(pins.NEXT_PUBLIC_KERYX_NETWORK, profile.name);
    const registry = pins.NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS ?? `0x${'0'.repeat(40)}`;
    const readRegistry = pins.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS ?? registry;
    if (profile.name === 'arc') assert.notEqual(registry, `0x${'0'.repeat(40)}`, 'Mainnet build must expose its nonzero public registry pin');
    env('KERYX_NETWORK', profile.name); env('NEXT_PUBLIC_KERYX_NETWORK', profile.name);
    env('KERYX_REGISTRY_ADDRESS', registry); env('NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS', registry);
    env('KERYX_REGISTRY_READ_ADDRESS', readRegistry); env('NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS', readRegistry);
    const runAgent = await exported('runAgent'), getReasoningEngine = await exported('getReasoningEngine');
    const config = await exported('config'), tavilyProvider = await exported('tavilyProvider');
    assert.equal(typeof runAgent, 'function'); assert.equal(typeof getReasoningEngine, 'function');
    assert.equal(config.webSearchProvider, 'tavily'); assert.equal(config.tavilyApiKey, 'synthetic-compiled-search-key');
    const engine = getReasoningEngine('deepseek-flash');
    assert.equal(engine.name, 'llm:deepseek:deepseek-v4-flash');
    await assert.rejects(engine.decompose(questions[0]), /current admitted question/);
    await assert.rejects(tavilyProvider('synthetic-compiled-search-key').search('Outside context'), /current admitted question/);
    assert.deepEqual(calls, { model: 0, search: 0, forbidden: 0 });
    const effects = { scope: { kind: 'public' }, getCached: async () => null, getCachedAt: async () => null,
      setCached: forbidden, recordPayment: forbidden, saveQueryRun: forbidden, discoverExternal: forbidden,
      decisionContext: async () => ({ memory: '', reputation: '', sample: 0 }), saveMemory: forbidden,
      notifyCitation: forbidden, alert: forbidden, activation: forbidden };
    const deps = { engine, effects, db: { listSources: async () => [], listPublicReferences: async () => [] },
      gateway: { mode: 'real', ensureFunded: forbidden, payFetch: forbidden, payCitation: forbidden }, readWebArticle: forbidden };
    const input = { question: questions[0], queryId: 'synthetic-compiled-query', budget: 0,
      researchMode: 'quick', origin: 'web', fundingOwner: 'treasury' };
    const generator = runAgent(input, deps);
    let next = await generator.next();
    assert.equal(next.done, false); assert.equal(holds('question').length, 1);
    assert.equal(calls.model, 0, 'Question admission must precede the first yielded step');
    while (!next.done) next = await generator.next();
    const result = next.value;
    assert.equal(result.question, questions[0]); assert.equal(result.budget, 0); assert.equal(result.researchMode, 'quick');
    assert.equal(result.paymentMode, 'real'); assert.equal(result.fundingOwner, 'treasury');
    assert.equal(result.totalSpent, 0); assert.equal(result.paymentAttempts, 0);
    assert.deepEqual(result.citations, []); assert.match(result.answer, /^No supported answer:/);
    assert.equal(result.trace.at(-1).phase, 'done');
    assert.deepEqual(calls, { model: 2, search: 2, forbidden: 0 });
    assert.deepEqual([holds('question').length, holds('model').length, holds('search').length], [1, 2, 2]);
    const question = JSON.parse(fs.readFileSync(path.join(fixture.journalDirectory, holds('question')[0]), 'utf8'));
    assert.equal(question.questionSha256, hash(questions[0])); assert.equal(question.queryIdSha256, hash(input.queryId));
    let reservedMicroUsd = 0;
    for (const name of [...holds('model'), ...holds('search')]) {
      const file = path.join(fixture.journalDirectory, name), stat = fs.lstatSync(file);
      assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.nlink, 1);
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(record.policySha256, fixture.digest); assert.equal(record.questionSha256, question.questionSha256);
      assert.equal(record.queryIdSha256, question.queryIdSha256);
      assert.equal(record.reserveMicroUsd, record.kind === 'model' ? 20660 : 8000);
      reservedMicroUsd += record.reserveMicroUsd;
    }
    assert.equal(reservedMicroUsd, 57320);
    await assert.rejects(runAgent(input, deps).next(), /already consumed/);
    await assert.rejects(engine.decompose(questions[0]), /current admitted question/);
    await assert.rejects(tavilyProvider('synthetic-compiled-search-key').search('After completion'), /current admitted question/);
    assert.deepEqual(calls, { model: 2, search: 2, forbidden: 0 });
    console.log(JSON.stringify({ format: 'keryx-built-research-allowance-acceptance-v1', result: 'pass',
      platform: process.platform, node: process.version, buildNetwork: profile.name, sharedProductionAskGraph: true, protectedQuestionHolds: 1,
      modelHolds: 2, searchHolds: 2, reservedMicroUsd, outsideContextHttpRefused: true,
      duplicateQuestionRefused: true, paymentCallbacks: 0, syntheticHttpOnly: true, productionCalls: 0 }));
  } finally {
    globalThis.Date = OriginalDate; globalThis.fetch = originalFetch;
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (fixture) {
      const root = path.resolve(fixture.root), parent = path.resolve(os.tmpdir());
      assert.equal(path.dirname(root), parent); assert(path.basename(root).startsWith(prefix));
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
