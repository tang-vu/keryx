/** Synthetic SQLite benchmark only. No environment files, HTTP, wallets or live DB. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SqliteAdapter } from "../lib/db/sqlite-adapter";
import { buildArchive, buildArchiveStream } from "../lib/answers-archive";
import type { QueryRun } from "../lib/types";

const [mode, file] = process.argv.slice(2);
if (mode === "bulk" || mode === "stream") {
  assert(file);
  let peak = process.memoryUsage().heapUsed;
  const sample = () => { peak = Math.max(peak, process.memoryUsage().heapUsed); };
  let entries;
  if (mode === "bulk") {
    const db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT data FROM query_runs ORDER BY created_at DESC, id DESC LIMIT 2500").all();
    sample();
    const runs = rows.map(row => JSON.parse(row.data as string) as QueryRun);
    sample();
    entries = buildArchive(runs); sample(); db.close();
  } else {
    const db = new SqliteAdapter(file, { readOnly: true });
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
    const db = new DatabaseSync(fixture);
    try {
      db.exec("CREATE TABLE query_runs(id TEXT PRIMARY KEY, created_at TEXT, data TEXT); BEGIN");
      const insert = db.prepare("INSERT INTO query_runs VALUES (?, ?, ?)");
      for (let i = 0; i < 2500; i++) {
        const run: QueryRun = { id: `synthetic-${String(i).padStart(4, "0")}`, question: `Synthetic question ${i % 50}?`,
          createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(), budget: 1, engine: "heuristic",
          subClaims: [], decisions: [], answer: "Synthetic answer [S1].", totalSpent: 0, totalToCreators: 0,
          citations: [{ marker: "S1", sourceId: "fixture", sourceName: "Synthetic", weight: 1, reward: 0, rationale: "Fixture" }],
          trace: [{ phase: "verdict", detail: { level: "Low", reason: "Synthetic only", padding: "trace ".repeat(7000) } } as QueryRun["trace"][number]] };
        insert.run(run.id, run.createdAt, JSON.stringify(run));
      }
      db.exec("COMMIT");
    } finally { db.close(); }
    const measure = (kind: string) => {
      const result = spawnSync(process.execPath, ["--max-old-space-size=512", "--import", "tsx", fileURLToPath(import.meta.url), kind, fixture],
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
