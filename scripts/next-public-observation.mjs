import { getHeapStatistics } from 'node:v8';
import { openSync, closeSync, fstatSync, lstatSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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
export function createPublicRequestObservation({ diagnosticUntil, dir, writeDiagnostic = line => console.log(line) } = {}) {
  const diagnostic = diagnosticUntil ? createFiniteDiagnostic(diagnosticUntil, dir, writeDiagnostic) : null;
  const groups = surfaces.flatMap(surface => methods.map(method => ({
    surface, method, seen: 0, active: 0, responsesFinished: 0, closedBeforeFinish: 0,
    busySince: 0, maxObservedMs: 0, statusFamilies: [0, 0, 0, 0, 0, 0],
  })));

  const observe = (req, res, admittedToNext = false) => {
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
    if (admittedToNext) diagnostic?.observe(req, res);
  };

  const snapshot = stage => {
    if (stage !== 'drain-start' && stage !== 'http-drained') throw Error('INVALID_PUBLIC_OBSERVATION_STAGE');
    if (stage === 'drain-start') diagnostic?.close('drain');
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
  return { observe, snapshot, dispose: () => diagnostic?.close('disposed') };
}


const DIAGNOSTIC = Object.freeze({ maxMs: 600000, maxRequests: 32, maxActive: 16,
  maxCatalogBytes: 512 * 1024, maxTemplates: 1024, maxPathChars: 2048, maxLineBytes: 2048 });

// Read only bounded metadata from this server's own prepared build. Never use
// request targets as labels, compile manifest regexes, or read application data.
function incomingTemplates(dir) {
  if (typeof dir !== 'string') throw Error('catalog');
  const file = resolve(dir, '.next', 'app-path-routes-manifest.json');
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > DIAGNOSTIC.maxCatalogBytes) throw Error('catalog');
  const fd = openSync(file, 'r'); let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino || stat.size !== before.size) throw Error('catalog');
    const buffer = Buffer.alloc(DIAGNOSTIC.maxCatalogBytes + 1); let used = 0, n;
    while (used < buffer.length && (n = readSync(fd, buffer, used, buffer.length - used, used)) !== 0) used += n;
    const after = fstatSync(fd);
    if (used > DIAGNOSTIC.maxCatalogBytes || used !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw Error('catalog');
    bytes = buffer.subarray(0, used);
  } finally { closeSync(fd); }
  const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('catalog');
  const values = Object.values(raw);
  if (!values.length || values.length > DIAGNOSTIC.maxTemplates || values.some(value => typeof value !== 'string')) throw Error('catalog');
  const shapes = new Set();
  const templates = [...new Set(values)].map(label => {
    if (!label.startsWith('/') || label.startsWith('//') || /[?\\\u0000-\u0020\u007f]/.test(label)
      || Buffer.byteLength(label) > 512 || (label !== '/' && label.endsWith('/'))) throw Error('catalog');
    const pieces = label === '/' ? [] : label.slice(1).split('/');
    if (pieces.length > 64 || pieces.some(piece => !piece || piece.length > 128)) throw Error('catalog');
    const parts = pieces.map((piece, index) => {
      if (/^\[\[\.\.\.[^\[\]/]+\]\]$/.test(piece)) {
        if (index !== pieces.length - 1) throw Error('catalog'); return { kind: 0 };
      }
      if (/^\[\.\.\.[^\[\]/]+\]$/.test(piece)) {
        if (index !== pieces.length - 1) throw Error('catalog'); return { kind: 1 };
      }
      if (/^\[[^\[\]/]+\]$/.test(piece)) return { kind: 2 };
      if (/[\[\]]/.test(piece)) throw Error('catalog');
      return { kind: 3, value: piece };
    });
    const shape = JSON.stringify(parts);
    if (shapes.has(shape)) throw Error('catalog'); shapes.add(shape);
    return { label, parts };
  });
  templates.sort((a, b) => {
    for (let i = 0; i < Math.max(a.parts.length, b.parts.length); i++) {
      const difference = (b.parts[i]?.kind ?? 4) - (a.parts[i]?.kind ?? 4);
      if (difference) return difference;
    }
    return a.label.localeCompare(b.label);
  });
  return { templates, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function incomingTemplate(target, templates) {
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return 'unmatched';
  const query = target.indexOf('?'); let path = query === -1 ? target : target.slice(0, query);
  if (path.length > DIAGNOSTIC.maxPathChars || /[\\\u0000-\u0020\u007f]/.test(path)) return 'unmatched';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const pieces = path === '/' ? [] : path.slice(1).split('/');
  if (pieces.length > 64 || pieces.some(piece => !piece)) return 'unmatched';
  for (const { label, parts } of templates) {
    let i = 0;
    for (; i < parts.length; i++) {
      const part = parts[i];
      if (part.kind === 0 || (part.kind === 1 && pieces.length > i)) return label;
      if (part.kind === 1 || pieces[i] === undefined || (part.kind === 3 && part.value !== pieces[i])) break;
    }
    if (i === parts.length && pieces.length === i) return label;
  }
  return 'unmatched';
}

/** One frozen, opt-in window per observer instance. No request/response objects
 * enter the metadata map; listeners live only on already-active responses. */
function createFiniteDiagnostic(until, dir, write) {
  const rejected = reason => {
    try { write(JSON.stringify({ format: 'keryx-private-request-diagnostic-v1', event: 'disabled', reason })); } catch { /* diagnostic only */ }
    return null;
  };
  const wallNow = Date.now(), start = performance.now();
  if (typeof until !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(until)) return rejected('invalid-window');
  const deadline = Date.parse(until), remaining = deadline - wallNow;
  if (!Number.isFinite(deadline) || new Date(deadline).toISOString() !== until || remaining <= 0 || remaining > DIAGNOSTIC.maxMs) return rejected('invalid-window');
  let catalog;
  try { catalog = incomingTemplates(dir); } catch { return rejected('catalog-unavailable'); }
  if (Date.now() >= deadline || performance.now() >= start + remaining) return rejected('invalid-window');
  const monotonicDeadline = start + remaining, window = randomUUID(), active = new Map();
  let closed = false, timer, started = 0, finished = 0, premature = 0, skippedBusy = 0, skippedBudget = 0;
  const stop = () => { closed = true; if (timer) clearTimeout(timer); active.clear(); };
  const emit = record => {
    if (closed) return false;
    try {
      const observedAt = Date.now();
      if (['start', 'finish', 'close'].includes(record.event) &&
        (observedAt >= deadline || performance.now() >= monotonicDeadline)) { close('expired'); return false; }
      const line = JSON.stringify({ format: 'keryx-private-request-diagnostic-v1', window, pid: process.pid,
        at: new Date(observedAt).toISOString(), ...record });
      if (Buffer.byteLength(line) > DIAGNOSTIC.maxLineBytes) { stop(); return false; }
      write(line); return true;
    } catch { stop(); return false; }
  };
  const close = reason => {
    if (closed) return;
    emit({ event: 'window-close', reason, started, finished, closedBeforeFinish: premature,
      unresolved: active.size, skippedBusy, skippedBudget });
    stop();
  };
  const expired = () => {
    if (closed) return true;
    if (Date.now() >= deadline || performance.now() >= monotonicDeadline) { close('expired'); return true; }
    return false;
  };
  if (!emit({ event: 'window-open', until, catalogSha256: catalog.sha256, templateCount: catalog.templates.length,
    maxRequests: DIAGNOSTIC.maxRequests, maxActive: DIAGNOSTIC.maxActive, maxLineBytes: DIAGNOSTIC.maxLineBytes })) return null;
  timer = setTimeout(() => close('expired'), Math.max(0, monotonicDeadline - performance.now())); timer.unref();
  const observe = (req, res) => {
    if (expired()) return;
    if (started >= DIAGNOSTIC.maxRequests) { skippedBudget = count(skippedBudget); return; }
    if (active.size >= DIAGNOSTIC.maxActive) { skippedBusy = count(skippedBusy); return; }
    try {
      const sequence = ++started;
      const entry = { sequence, incomingTemplate: incomingTemplate(req.url, catalog.templates),
        method: req.method === 'GET' || req.method === 'HEAD' ? 'get-head' : req.method === 'POST' ? 'post' : 'other',
        started: performance.now(), cpu: process.cpuUsage() };
      active.set(sequence, entry);
      if (!emit({ event: 'start', sequence, incomingTemplate: entry.incomingTemplate, method: entry.method })) return;
      let ended = false;
      const settle = complete => {
        if (ended) return;
        ended = true; res.off('finish', finish); res.off('close', closeResponse);
        if (expired()) return;
        active.delete(sequence);
        if (complete) finished++; else premature++;
        try {
          const cpu = process.cpuUsage(entry.cpu), processCpuMicros = cpu.user + cpu.system;
          if (!Number.isSafeInteger(processCpuMicros) || processCpuMicros < 0) { stop(); return; }
          emit({ event: complete ? 'finish' : 'close', sequence, incomingTemplate: entry.incomingTemplate,
            method: entry.method, statusCode: Number.isInteger(res.statusCode) && res.statusCode >= 100 && res.statusCode <= 999 ? res.statusCode : 0,
            elapsedMs: Math.max(0, Math.round(performance.now() - entry.started)), processCpuMicros });
          if (!closed && started === DIAGNOSTIC.maxRequests && active.size === 0) close('budget');
        } catch { stop(); }
      };
      const finish = () => settle(true), closeResponse = () => settle(res.writableFinished);
      res.once('finish', finish); res.once('close', closeResponse);
    } catch { stop(); }
  };
  return { observe, close };
}
