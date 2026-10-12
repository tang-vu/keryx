// Read-only observations of a selected public deployment, never payment acceptance.
const NETWORKS = { arc: 'eip155:5042', arcTestnet: 'eip155:5042002' };
const MAX_JSON_BYTES = 256 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = value => Number.isSafeInteger(value) && value >= 0;
const utc = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

export function deploymentOptions(input) {
  let url;
  try { url = new URL(input.origin ?? 'https://keryx.cc'); } catch { throw new Error('Invalid origin'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/'
    || !(url.protocol === 'https:' || url.protocol === 'http:' && loopback)) {
    throw new Error('Use a bare HTTPS origin, or HTTP on loopback, without credentials');
  }
  if (!Object.hasOwn(NETWORKS, input.network ?? 'arc')) throw new Error('Network must be arc or arcTestnet');
  if (typeof input.expectedCommit !== 'string' || !/^[a-f0-9]{40}$/.test(input.expectedCommit)) {
    throw new Error('Expected commit must be a full lowercase Git SHA');
  }
  const timeoutMs = input.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('Timeout must be an integer between 100 and 30000 milliseconds');
  }
  return { origin: url.origin, network: input.network ?? 'arc', expectedCommit: input.expectedCommit,
    timeoutMs, requireMonitoring: input.requireMonitoring === true };
}

async function jsonBody(response) {
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (!(type === 'application/json' || /^application\/[\w.-]+\+json$/.test(type ?? ''))) {
    throw new Error('content-type');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('body');
  let bytes = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_JSON_BYTES) throw new Error('body-limit');
      chunks.push(value);
    }
    const body = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
  } finally { void reader.cancel().catch(() => {}); }
}

async function observe(spec, options, fetchImpl) {
  const controller = new AbortController();
  let timer;
  const work = (async () => {
    let response;
    try {
      response = await fetchImpl(new URL(spec.path, options.origin), {
        method: 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Accept: spec.json ? 'application/json' : 'text/html', 'User-Agent': 'keryx-public-deployment-check' },
      });
      const httpStatus = response.status;
      if (httpStatus !== 200) return { ...spec, status: 'fail', httpStatus,
        detail: httpStatus >= 300 && httpStatus < 400 ? 'Redirect refused; deployment was not observed' : `HTTP ${httpStatus}; unavailable, not evidence of source drift` };
      if (!spec.json) {
        const html = /^text\/html(?:;|$)/i.test(response.headers.get('content-type') ?? '');
        return { ...spec, status: html ? 'pass' : 'fail', httpStatus,
          detail: html ? 'HTML route reachable; rendering and interactions are untested' : 'Expected an HTML response' };
      }
      return { ...spec, httpStatus, data: await jsonBody(response) };
    } catch {
      // Do not echo error messages, response bodies or headers from external servers.
      return { ...spec, status: 'fail', detail: controller.signal.aborted
        ? 'Observation timed out; availability is unknown' : 'Could not read bounded JSON or reach the endpoint' };
    } finally { if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {}); }
  })();
  const deadline = new Promise(resolve => { timer = setTimeout(() => {
    controller.abort(); resolve({ ...spec, status: 'fail', detail: 'Observation timed out; availability is unknown' });
  }, options.timeoutMs); });
  try { return await Promise.race([work, deadline]); } finally { clearTimeout(timer); }
}

function verdict(observation, valid, detail) {
  return { id: observation.id, path: observation.path, status: valid ? 'pass' : 'fail',
    ...(observation.httpStatus ? { httpStatus: observation.httpStatus } : {}), detail };
}

function assess(observations, options, now) {
  const checks = [];
  for (const row of observations) {
    if (row.status) { checks.push(verdict(row, row.status === 'pass', row.detail)); continue; }
    const data = row.data;
    if (row.id === 'health') {
      const valid = object(data) && data.name === 'keryx' && data.ok === true && data.db === 'ok'
        && data.status === 'operational' && data.network === options.network
        && ['real', ...(options.network === 'arcTestnet' ? ['offline'] : [])].includes(data.settles)
        && utc(data.time) && Date.parse(data.time) <= now + 30_000 && now - Date.parse(data.time) <= 120_000;
      checks.push(verdict(row, valid, valid ? 'Fresh Keryx liveness response on the expected profile; payment and model availability remain unprobed'
        : 'Health is malformed, degraded, stale or on a different profile'));
      const reported = object(data) ? data.commit : undefined;
      const matches = typeof reported === 'string' && /^[a-f0-9]{7,40}$/.test(reported)
        && options.expectedCommit.startsWith(reported);
      checks.push(verdict({ ...row, id: 'commit' }, matches, matches
        ? `Reported ${reported.length}-character commit matches the expected SHA${reported.length < 40 ? ' prefix; full source attestation remains separate' : '; runtime self-report only'}`
        : 'Reported commit is missing, invalid or differs from the expected SHA'));
      const monitoring = object(data) ? data.monitoring : undefined;
      const names = ['registry', 'dispatches', 'settlement', 'reconciliation'];
      const recent = object(monitoring) && monitoring.state === 'recent' && Array.isArray(monitoring.checks)
        && monitoring.checks.length === names.length && names.every(name => {
          const rows = monitoring.checks.filter(check => object(check) && check.name === name);
          const check = rows[0];
          return rows.length === 1 && check.state === 'recent' && utc(check.checkedAt)
            && count(check.maxAgeSeconds) && check.maxAgeSeconds > 0
            && Date.parse(check.checkedAt) <= now && now - Date.parse(check.checkedAt) <= check.maxAgeSeconds * 1000;
        });
      checks.push({ id: 'monitoring', path: row.path, status: recent ? 'pass' : options.requireMonitoring ? 'fail' : 'warn',
        detail: recent ? 'Recorded monitoring timestamps are recent; verdicts and active schedules are not certified'
          : 'Recorded monitoring is missing, stale or malformed; no current monitoring assurance' });
    } else if (row.id === 'metrics') {
      const valid = object(data) && object(data.metricsScope) && data.metricsScope.cohort === 'mixed-all-origins'
        && data.metricsScope.period === 'all-time' && data.metricsScope.network === 'not-row-partitioned'
        && object(data.usage) && data.usage.endpoint === '/api/usage' && data.usage.unclassifiedIsOutside === false
        && object(data.metrics) && count(data.metrics.totalQueries) && count(data.metrics.totalPayments);
      checks.push(verdict(row, valid, valid ? 'Aggregate scope remains explicit; these totals are not outside-user or selected-network traction'
        : 'Aggregate metrics omit the expected scope and counting boundaries'));
    } else if (row.id === 'usage') {
      const valid = object(data) && data.complete === true && data.basis === 'complete-bounded-database-window'
        && data.network === NETWORKS[options.network] && data.period === 'all'
        && data.since === '1970-01-01T00:00:00.000Z' && utc(data.until)
        && Date.parse(data.until) <= now + 30_000 && now - Date.parse(data.until) <= 120_000
        && Array.isArray(data.columns) && data.columns.length === 4
        && ['outside', 'team', 'scripted', 'unknown'].every(cohort => {
          const rows = data.columns.filter(column => object(column) && column.cohort === cohort);
          return rows.length === 1 && count(rows[0].researchRuns) && count(rows[0].settledPayments)
            && typeof rows[0].settledMicros === 'string' && /^(0|[1-9]\d*)$/.test(rows[0].settledMicros);
        });
      checks.push(verdict(row, valid, valid ? 'Complete recorded usage window declares the expected network and four cohorts; attribution and settlements are not independently audited'
        : 'Usage is incomplete, malformed, stale or on a different network'));
    }
  }
  return checks;
}

export async function verifyPublicDeployment(input, { fetchImpl = fetch, now = Date.now } = {}) {
  const options = deploymentOptions(input);
  const specs = [
    { id: 'health', path: '/api/health', json: true },
    { id: 'metrics', path: '/api/metrics', json: true },
    { id: 'usage', path: `/api/usage?network=${NETWORKS[options.network]}`, json: true },
    ...['/', '/status', '/proof'].map(path => ({ id: `page:${path}`, path, json: false })),
  ];
  const observations = [];
  // Two public reads at a time; never add a paid request, wallet or scheduler to this checker.
  for (let index = 0; index < specs.length; index += 2) {
    observations.push(...await Promise.all(specs.slice(index, index + 2).map(spec => observe(spec, options, fetchImpl))));
  }
  const observedAt = now();
  const checks = assess(observations, options, observedAt);
  return { origin: options.origin, network: options.network, expectedCommit: options.expectedCommit,
    observedAt: new Date(observedAt).toISOString(), status: checks.some(check => check.status === 'fail') ? 'fail' : 'pass',
    warnings: checks.filter(check => check.status === 'warn').length, checks,
    limits: ['GET-only, anonymous, bounded observations; no credentials or environment files loaded',
      'Endpoints are observed independently, not as one atomic snapshot',
      'No paid research, signing, settlement, source ownership, usefulness, package identity or scheduler activation is verified'] };
}
