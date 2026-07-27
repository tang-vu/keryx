import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";

const dbFile = path.join(os.tmpdir(), `keryx-onramp-${Date.now()}-${process.pid}.sqlite`);
let db: SqliteAdapter;

beforeEach(async () => {
  db = new SqliteAdapter(dbFile);
  await db.init();
});

afterEach(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(dbFile + suffix); } catch { /* already removed */ }
  }
});

describe("atomic onramp reservations", () => {
  it("admits one concurrent claim per address", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.reserveOnramp("onramp:0xabc", "onramp-day:2026-07-27", 0.7, 20, Date.now()),
      ),
    );
    expect(results.filter((r) => r === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r === "already-funded")).toHaveLength(9);
  });

  it("never reserves beyond the shared daily cap", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.reserveOnramp(`onramp:0x${i}`, "onramp-day:2026-07-27", 0.7, 2.1, Date.now()),
      ),
    );
    expect(results.filter((r) => r === "reserved")).toHaveLength(3);
    expect(results.filter((r) => r === "daily-cap")).toHaveLength(7);
  });

  it("returns a failed transfer's reservation", async () => {
    expect(await db.reserveOnramp("onramp:0xabc", "day", 0.7, 1, Date.now())).toBe("reserved");
    await db.releaseOnramp("onramp:0xabc", "day", 0.7);
    expect(await db.reserveOnramp("onramp:0xabc", "day", 0.7, 1, Date.now())).toBe("reserved");
  });
});
