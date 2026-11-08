import { getHeapStatistics } from 'node:v8';

const surfaces = ['health', 'api', 'asset', 'page'];
const methods = ['get-head', 'post', 'other'];
const count = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1);
const sum = values => values.reduce((total, value) => Math.min(Number.MAX_SAFE_INTEGER, total + value), 0);

function surface(target) {
  if (target === '/api/health' || target?.startsWith('/api/health?')) return 'health';
  if (target?.startsWith('/api/')) return 'api';
  return target?.startsWith('/_next/') ? 'asset' : 'page';
}

/** Passive, fixed-cardinality transport counters. Never retain request contents. */
export function createPublicRequestObservation() {
  const groups = surfaces.flatMap(surface => methods.map(method => ({
    surface, method, seen: 0, active: 0, responsesFinished: 0, closedBeforeFinish: 0,
    busySince: 0, maxObservedMs: 0, statusFamilies: [0, 0, 0, 0, 0, 0],
  })));

  const observe = (req, res) => {
    const method = req.method === 'GET' || req.method === 'HEAD' ? 'get-head' : req.method === 'POST' ? 'post' : 'other';
    const group = groups.find(value => value.surface === surface(req.url) && value.method === method);
    const started = performance.now();
    group.seen = count(group.seen);
    if (group.active++ === 0) group.busySince = started;
    let ended = false;
    const settle = finished => {
      if (ended) return;
      ended = true;
      res.off('finish', finish); res.off('close', close);
      group.active--;
      if (group.active === 0) group.busySince = 0;
      group.maxObservedMs = Math.max(group.maxObservedMs, Math.round(performance.now() - started));
      if (finished) {
        group.responsesFinished = count(group.responsesFinished);
        const family = Math.floor(res.statusCode / 100);
        const index = family >= 1 && family <= 5 ? family - 1 : 5;
        group.statusFamilies[index] = count(group.statusFamilies[index]);
      } else group.closedBeforeFinish = count(group.closedBeforeFinish);
    };
    const finish = () => settle(true);
    // Node also emits close after a normal finish. It is not always an abort.
    const close = () => settle(res.writableFinished);
    res.once('finish', finish); res.once('close', close);
  };

  const snapshot = stage => {
    if (stage !== 'drain-start' && stage !== 'http-drained') throw Error('INVALID_PUBLIC_OBSERVATION_STAGE');
    const now = performance.now();
    const memory = process.memoryUsage();
    return {
      format: 'keryx-public-request-observation-v1', stage, at: new Date().toISOString(), pid: process.pid,
      seen: sum(groups.map(value => value.seen)), active: sum(groups.map(value => value.active)),
      responsesFinished: sum(groups.map(value => value.responsesFinished)),
      closedBeforeFinish: sum(groups.map(value => value.closedBeforeFinish)),
      groups: groups.filter(value => value.seen).map(({ busySince, statusFamilies, ...value }) => ({
        ...value, busyForMs: value.active ? Math.round(now - busySince) : 0,
        statusFamilies: [...statusFamilies],
      })),
      memory: { rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external, heapLimitBytes: getHeapStatistics().heap_size_limit },
    };
  };
  return { observe, snapshot };
}
