import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { claimSqliteSourceUpkeep, finishSqliteSourceUpkeep } from "./source-upkeep";

const hour = 3_600_000;
function setup(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS sync_state(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
    CREATE TABLE IF NOT EXISTS public_references(id TEXT PRIMARY KEY,active INTEGER,rss_url TEXT);
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,active INTEGER,verified INTEGER,rss_url TEXT);`);
  return db;
}
function add(db: DatabaseSync, id: string, active = 1, verified = 1, feed = "https://publisher.test/rss") {
  db.prepare("INSERT INTO sources VALUES (?,?,?,?)").run(id, active, verified, feed);
}

describe("atomic scheduled source allowance", () => {
  it("admits only one of two simultaneously started maintenance processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-upkeep-race-"));
    const file = join(directory, "ledger.sqlite");
    const db = setup(file);
    add(db, "a"); add(db, "b");
    db.close();
    const moduleUrl = new URL("./source-upkeep.ts", import.meta.url).href;
    const script = `import {DatabaseSync} from 'node:sqlite';
      import {claimSqliteSourceUpkeep} from ${JSON.stringify(moduleUrl)};
      const db=new DatabaseSync(${JSON.stringify(file)});
      db.exec('PRAGMA busy_timeout=5000');
      console.log(JSON.stringify(claimSqliteSourceUpkeep(db,${hour})));
      db.close();`;
    try {
      const run = () => promisify(execFile)(process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script]);
      const results = await Promise.all([run(), run()]);
      const claims = results.map((result) => JSON.parse(result.stdout));
      expect(claims.filter(Boolean)).toHaveLength(1);
      expect(claims.filter(Boolean)[0].sourceIds).toEqual(["a", "b"]);
    } finally { rmSync(directory, { recursive: true }); }
  });

  it("serializes independent connections, consumes failed slots and resumes a fair cursor after restart", () => {
    const directory = mkdtempSync(join(tmpdir(), "keryx-upkeep-"));
    const file = join(directory, "ledger.sqlite");
    let first = setup(file);
    const second = setup(file);
    try {
      for (const id of ["a", "b", "c", "d", "e"]) add(first, id);
      add(first, "inactive", 0); add(first, "unverified", 1, 0); add(first, "no-feed", 1, 1, " ");
      const claim = claimSqliteSourceUpkeep(first, hour)!;
      expect(claim.sourceIds).toEqual(["a", "b"]);
      expect(claimSqliteSourceUpkeep(second, hour + 1)).toBeNull();
      finishSqliteSourceUpkeep(first, claim, { attempted: 2, added: 0, failed: 2, skipped: 0 }, hour + 10);
      expect(claimSqliteSourceUpkeep(second, hour + 20)).toBeNull();
      first.close(); first = setup(file);
      expect(claimSqliteSourceUpkeep(first, hour * 2)?.sourceIds).toEqual(["c", "d"]);
      // Interrupted job was already consumed, including after lease expiry.
      expect(claimSqliteSourceUpkeep(second, hour * 2 + 180_000)).toBeNull();
      expect(claimSqliteSourceUpkeep(second, hour * 3)?.sourceIds).toEqual(["e", "a"]);
      expect(claimSqliteSourceUpkeep(first, hour * 4)?.sourceIds).toEqual(["b", "c"]);
      expect(claimSqliteSourceUpkeep(second, hour)).toBeNull();
    } finally { first.close(); second.close(); rmSync(directory, { recursive: true }); }
  });

  it("prevents overlap across an hour boundary and never applies stale completion", () => {
    const db = setup();
    try {
      add(db, "one");
      const first = claimSqliteSourceUpkeep(db, hour - 1)!;
      expect(claimSqliteSourceUpkeep(db, hour)).toBeNull();
      const next = claimSqliteSourceUpkeep(db, hour + 120_000)!;
      expect(next.sourceIds).toEqual(["one"]);
      finishSqliteSourceUpkeep(db, first, { attempted: 1, added: 1, failed: 0, skipped: 0 }, hour + 130_000);
      expect(JSON.parse(String(db.prepare("SELECT value FROM sync_state").get()!.value)).slot).toBe(next.slot);
    } finally { db.close(); }
  });

  it.each(["{", "null", "{}", '{"slot":-1,"cursor":"","leaseUntil":0}',
    '{"slot":1,"cursor":"","leaseUntil":"0"}',
    '{"slot":1,"cursor":"","leaseUntil":0,"summary":{"attempted":999}}'])
    ("fails closed with corrupted persisted budget %s", (value) => {
      const db = setup();
      try {
        add(db, "a");
        db.prepare("INSERT INTO sync_state VALUES ('sourceUpkeep',?,NULL)").run(value);
        expect(() => claimSqliteSourceUpkeep(db, hour * 10)).toThrow();
        expect(db.prepare("SELECT value FROM sync_state").get()!.value).toBe(value);
      } finally { db.close(); }
    });
});


it("shares one two-feed allowance and fair cursor across owned and free catalogs", () => {
  const db = setup();
  try {
    add(db, "owned-a"); add(db, "owned-b"); add(db, "public:forged-paid");
    for (const id of ["public:a", "public:b", "public:c"])
      db.prepare("INSERT INTO public_references VALUES (?,1,?)").run(id, "https://public.test/feed");
    const visited = new Set<string>();
    for (let slot = 1; slot <= 3; slot++) {
      const claim = claimSqliteSourceUpkeep(db, slot * hour)!;
      expect(claim.sourceIds).toHaveLength(2);
      claim.sourceIds.forEach((id) => visited.add(id));
      expect(claim.sourceIds).not.toContain("public:forged-paid");
      expect(claimSqliteSourceUpkeep(db, slot * hour + 1)).toBeNull();
    }
    expect([...visited].sort()).toEqual(["owned-a", "owned-b", "public:a", "public:b", "public:c"]);
  } finally { db.close(); }
});
