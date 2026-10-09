/** Actual offline browser WebCrypto parity. No app, environment, DB, provider or payment imports. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build, version as esbuildVersion } from "esbuild";
import { chromium, type Browser } from "playwright";
import { canonicalDecisionRecord, createDecisionRecord, decisionRecordHash, type ReadPolicyInput } from "../lib/research-audit/decision-record.ts";

type BrowserAudit = typeof import("../lib/research-audit/decision-record.ts");
async function bounded<T>(promise: Promise<T>, label: string, milliseconds = 10_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} exceeded its fixture deadline`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await build({ absWorkingDir: root, entryPoints: ["lib/research-audit/decision-record.ts"],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "KeryxAudit", target: "es2022", metafile: true, logLevel: "silent" });
assert.deepEqual(Object.keys(bundle.metafile!.inputs).sort(), ["lib/research-audit/decision-record.ts", "lib/research-audit/exact-units.ts"]);
assert.equal(bundle.outputFiles.length, 1);
assert(bundle.outputFiles[0].contents.byteLength <= 256 * 1024, "Bound the in-memory browser fixture");

const input = (patch: Partial<ReadPolicyInput> = {}): ReadPolicyInput => ({ candidateId: "fixture:one", proposal: "BUY",
  priceMicros: "1", budgetRemainingMicros: "10", priceCeilingMicros: "10", attentionRemaining: 2,
  eligible: true, external: false, cacheFresh: false, sufficient: false, requiresApproval: false, ...patch });
const cases = [
  { name: "BUY", patch: {}, action: "BUY", reserved: "1" },
  { name: "SKIP", patch: { proposal: "SKIP" }, action: "SKIP", reserved: "0" },
  { name: "CACHE", patch: { proposal: "CACHE", cacheFresh: true }, action: "CACHE", reserved: "0" },
  { name: "STOP", patch: { sufficient: true }, action: "STOP", reserved: "0" },
  { name: "ESCALATE", patch: { requiresApproval: true }, action: "ESCALATE", reserved: "0" },
  { name: "huge-exact", patch: { priceMicros: "9007199254740993", budgetRemainingMicros: "9007199254740993", priceCeilingMicros: "9007199254740993" }, action: "BUY", reserved: "9007199254740993" },
  { name: "thirty-digit-exact", patch: { priceMicros: "999999999999999999999999999999", budgetRemainingMicros: "999999999999999999999999999999", priceCeilingMicros: "999999999999999999999999999999" }, action: "BUY", reserved: "999999999999999999999999999999" },
  { name: "expired-cache", patch: { proposal: "CACHE" }, action: "BUY", reserved: "1" },
  { name: "outside-admission", patch: { external: true }, action: "SKIP", reserved: "0" },
  { name: "budget-refusal", patch: { budgetRemainingMicros: "0" }, action: "SKIP", reserved: "0" },
] satisfies Array<{ name: string; patch: Partial<ReadPolicyInput>; action: string; reserved: string }>;
const vectors = await Promise.all(cases.map(async fixture => {
  const record = createDecisionRecord(input(fixture.patch));
  assert.equal(record.outcome.action, fixture.action); assert.equal(record.outcome.reservedMicros, fixture.reserved);
  return { name: fixture.name, record, canonical: canonicalDecisionRecord(record), retainedHash: await decisionRecordHash(record) };
}));
const seed = vectors[0];
const mismatched = { ...seed.record, outcome: { ...seed.record.outcome, reservedMicros: "2" } };
const mismatchedHash = await decisionRecordHash(mismatched);
const requests: string[] = [];
const server = createServer({ maxHeaderSize: 8192 }, (request, response) => {
  requests.push(`${request.method} ${request.url}`);
  response.setHeader("Cache-Control", "no-store"); response.setHeader("Connection", "close");
  response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'none'; base-uri 'none'");
  if (request.method === "GET" && request.url === "/") {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end('<!doctype html><html lang="en"><head><title>Offline audit fixture</title><script src="/audit.js"></script></head><body>Offline source fixture</body></html>');
  } else if (request.method === "GET" && request.url === "/audit.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8"); response.end(bundle.outputFiles[0].text);
  } else { response.writeHead(404); response.end(); }
});
server.maxConnections = 4; server.headersTimeout = 5000; server.requestTimeout = 5000; server.keepAliveTimeout = 500;
let browser: Browser | undefined;
try {
  await bounded(new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); }), "Loopback listen");
  const address = server.address(); assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true, timeout: 15_000 });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const blocked: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    if ([`${origin}/`, `${origin}/audit.js`].includes(route.request().url()) && route.request().method() === "GET") return route.continue();
    blocked.push(route.request().url()); return route.abort();
  });
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "load", timeout: 5000 });
  const result = await bounded(page.evaluate(async ({ vectors, mismatched, mismatchedHash }) => {
    const api = (window as unknown as { KeryxAudit: BrowserAudit }).KeryxAudit;
    const rows = [];
    for (const fixture of vectors) {
      const reordered = { outcome: Object.fromEntries(Object.entries(fixture.record.outcome).reverse()),
        input: Object.fromEntries(Object.entries(fixture.record.input).reverse()), policy: fixture.record.policy, schema: fixture.record.schema };
      rows.push({ name: fixture.name, outcome: api.replayReadPolicy(fixture.record.input), canonical: api.canonicalDecisionRecord(fixture.record),
        hash: await api.decisionRecordHash(fixture.record), verified: await api.verifyDecisionRecord(fixture.record, fixture.retainedHash),
        reorderedHash: await api.decisionRecordHash(reordered), reorderedVerified: await api.verifyDecisionRecord(reordered, fixture.retainedHash) });
    }
    const seed = vectors[0];
    const mutated = structuredClone(seed.record), pending = api.verifyDecisionRecord(mutated, seed.retainedHash);
    const replacement = api.createDecisionRecord({ ...mutated.input, priceMicros: "2" });
    mutated.input = replacement.input; mutated.outcome = replacement.outcome;
    return { secureContext: isSecureContext, actualWebCrypto: typeof crypto.subtle.digest === "function", rows,
      changedInput: await api.verifyDecisionRecord({ ...seed.record, input: { ...seed.record.input, priceMicros: "2" } }, seed.retainedHash),
      wrongDigest: await api.verifyDecisionRecord(seed.record, "0".repeat(64)),
      inconsistentReplayWithMatchingHash: await api.verifyDecisionRecord(mismatched, mismatchedHash),
      unknownPolicy: await api.verifyDecisionRecord({ ...seed.record, policy: "future-policy" }, seed.retainedHash),
      extraPrivateField: await api.verifyDecisionRecord({ ...seed.record, question: "synthetic forbidden field" }, seed.retainedHash),
      asyncMutation: await pending };
  }, { vectors, mismatched, mismatchedHash }), "Actual browser WebCrypto");
  assert(result.secureContext); assert(result.actualWebCrypto);
  for (const [index, row] of result.rows.entries()) {
    const retained = vectors[index]; assert.deepEqual(row.outcome, retained.record.outcome);
    assert.equal(row.canonical, retained.canonical); assert.equal(row.hash, retained.retainedHash); assert(row.verified);
    assert.equal(row.reorderedHash, retained.retainedHash); assert(row.reorderedVerified);
  }
  for (const field of ["changedInput", "wrongDigest", "inconsistentReplayWithMatchingHash", "unknownPolicy", "extraPrivateField", "asyncMutation"] as const) assert.equal(result[field], false, field);
  assert.deepEqual(blocked, []); assert.deepEqual(errors, []); assert.deepEqual(requests.sort(), ["GET /", "GET /audit.js"]);
  console.log(JSON.stringify({ scope: "actual Chromium secure-loopback WebCrypto; synthetic policy corpus; no app or payment authority", node: process.version,
    browser: browser.version(), esbuild: esbuildVersion, cases: vectors.length, actions: ["BUY", "SKIP", "CACHE", "STOP", "ESCALATE"],
    exactHugeAmounts: true, canonicalAndHashParity: true, keyOrderParity: true, tamperRefusals: 5, asyncMutationRefused: true, externalRequests: 0 }));
} finally {
  try { if (browser) await bounded(browser.close(), "Chromium cleanup", 5000); }
  finally {
    if (server.listening) {
      const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections(); await bounded(closed, "Loopback cleanup", 5000);
    }
  }
}
