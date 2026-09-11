// Exercise the installed Next worker wrapper, without importing application code.
const assert = require("node:assert/strict");
const { getHeapStatistics } = require("node:v8");
exports.heapLimit = () => getHeapStatistics().heap_size_limit;
if (require.main === module) void (async () => {
  const parent = exports.heapLimit();
  assert.ok(parent >= 1536 * 1024 * 1024 && parent <= 2048 * 1024 * 1024,
    "Run with the deployment heap cap: node --max-old-space-size=1536 scripts/check-next-worker-memory.cjs");
  const { Worker } = require("next/dist/lib/worker");
  const worker = new Worker(__filename, { numWorkers: 1, exposedMethods: ["heapLimit"],
    isolatedMemory: true, enableWorkerThreads: true, debuggerPortOffset: -1 });
  try {
    assert.equal(await worker.heapLimit(), parent, "Next build thread must retain the bounded parent heap");
    console.log("PASS: installed Next build thread retains the explicit deployment heap cap.");
  } finally { await worker.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
