import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

// Execute the actual built Worker in workerd. Every outbound request is intercepted
// in memory: no production call, DNS lookup, API credential or scheduled allowance.
const bundle = await readFile(new URL("./.cloudflare/output/v0/workers/default/bundle/index.js", import.meta.url), "utf8");
const token = "a".repeat(43);
let responseStatus = 200;
const requests = [];
const runtime = new Miniflare(convertV4MiniflareOptions({
  compatibilityDate: "2026-09-30",
  modules: [
    { type: "ESModule", path: "harness.mjs", contents: `
      import actualWorker from './worker.mjs';
      export default { async fetch(_request, env) {
        try { await actualWorker.scheduled({}, env); return Response.json({status:'completed'}); }
        catch(error) { return Response.json({error:error.message}); }
      }};` },
    { type: "ESModule", path: "worker.mjs", contents: bundle },
  ],
  bindings: { SOURCE_UPKEEP_TOKEN: token },
  outboundService: async (request) => {
    requests.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization") });
    return new Response(null, { status: responseStatus,
      ...(responseStatus === 302 ? { headers: { Location: "https://redirect-fixture.invalid/" } } : {}) });
  },
}));
try {
  for (const status of [200, 302, 503]) {
    responseStatus = status;
    requests.length = 0;
    const result = await (await runtime.dispatchFetch("http://fixture.invalid/")).json();
    assert.deepEqual(result, status === 200 ? { status: "completed" } : { error: `Source upkeep HTTP ${status}` });
    assert.deepEqual(requests, [{ url: "https://keryx.cc/api/internal/source-upkeep", method: "POST", authorization: `Bearer ${token}` }]);
  }
  console.log("workerd upkeep smoke passed: fixed request, success, redirect refusal and no retries (network intercepted)");
} finally { await runtime.dispose(); }
