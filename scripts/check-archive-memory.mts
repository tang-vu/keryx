/** Synthetic SQLite benchmark only. No environment files, HTTP, wallets or live DB. */
import assert from "node:assert/strict";
import { openVerifiedSqliteStorage } from "../lib/db/storage-identity-connection";
import { provisionSyntheticStorage } from "../lib/db/storage-identity-fixture";
import { validateStorageIdentity } from "../lib/db/storage-identity";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { buildArchive, buildArchiveStream } from "../lib/answers-archive";
import type { QueryRun } from "../lib/types";

const [mode, file, encodedIdentity] = process.argv.slice(2);
if (mode === "bulk" || mode === "stream") {
  assert(file && encodedIdentity);
  const identity = validateStorageIdentity(JSON.parse(encodedIdentity));
  let peak = process.memoryUsage().heapUsed;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().heapUsed); };
  let entries;
  if (mode === "bulk") {
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly: true });
    const db = connection.db;
    const rows = db.prepare("SELECT data FROM query_runs ORDER BY created_at DESC, id DESC LIMIT 2500").all();
    sample();
    const runs = rows.map(row => JSON.parse(row.data as string) as QueryRun);
    sample();
    entries = buildArchive(runs); sample(); connection.close();
  } else {
    const db = new SqliteAdapter(file, { readOnly: true, expectedIdentity: identity });
    entries = await buildArchiveStream((async function* () {
      for await (const run of db.iterateRecentQueries(2500)) { sample(); yield run; sample(); }
    })());
    sample(); db.close();
  }
  console.log(JSON.stringify({ mode, entries: entries.length, peakHeapBytes: peak,
    digest: createHash("sha256").update(JSON.stringify(entries)).digest("hex") }));
} else {
  assert(!mode, "Run without arguments for the synthetic benchmark");
  const fixture = join(tmpdir(), `keryx-archive-memory-${randomUUID()}.sqlite`);
  try {
    const identity = await provisionSyntheticStorage(fixture, "testnet-offline");
    const adapter = new SqliteAdapter(fixture, { expectedIdentity: identity });
    await adapter.init(); adapter.close();
    const connection = openVerifiedSqliteStorage(fixture, identity);
    const db = connection.db;
    try {
      db.exec("BEGIN");
      const insert = db.prepare("INSERT INTO query_runs(id,created_at,data) VALUES (?, ?, ?)");
      for (let i = 0; i < 2500; i++) {
        const run: QueryRun = { id: `synthetic-${String(i).padStart(4, "0")}`, question: `Synthetic question ${i % 50}?`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), budget: 1, engine: "heuristic",
          subClaims: [], decisions: [], answer: "Synthetic answer [S1].", totalSpent: 0, totalToCreators: 0,
          citations: [{ marker: "S1", sourceId: "fixture", sourceName: "Synthetic", weight: 1, reward: 0, rationale: "Fixture" }],
          trace: [{ phase: "verdict", detail: { level: "Low", reason: "Synthetic only", padding: "trace ".repeat(7000) } } as QueryRun["trace"][number]] };
        insert.run(run.id, run.createdAt, JSON.stringify(run));
      }
      db.exec("COMMIT");
    } finally { connection.close(); }
    const measure = (kind: string) => {
      const result = spawnSync(process.execPath, ["--max-old-space-size=512", "--import", "tsx", fileURLToPath(import.meta.url), kind, fixture, JSON.stringify(identity)],
        { encoding: "utf8", timeout: 120_000, windowsHide: true });
      assert.equal(result.status, 0, `${kind} child failed: ${result.stderr}`);
      return JSON.parse(result.stdout.trim());
    };
    const bulk = measure("bulk"), stream = measure("stream");
    assert.equal(stream.digest, bulk.digest);
    assert.equal(stream.entries, 50);
    assert(stream.peakHeapBytes < bulk.peakHeapBytes * 0.6, "Expected substantially lower sampled heap");
    console.log(JSON.stringify({ synthetic: true, rows: 2500, bulk, stream }));
  } finally { rmSync(fixture, { force: true }); }
}
