/**
 * The two item-date queries behind answer freshness, on the real adapter.
 *
 * The thing a pure-logic test cannot catch: these compare dates as SQL strings. A row whose
 * `published_at` is not ISO-shaped sorts above every ISO date, so without the shape guard one
 * badly-dated feed item would read as newer than every dispatch ever settled.
 */

import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteAdapter } from "./sqlite-adapter";
import type { SourceItem } from "../types";

const dbFile = path.join(os.tmpdir(), `keryx-item-freshness-test-${process.pid}.sqlite`);
const db = new SqliteAdapter(dbFile);
await db.init();

afterAll(() => {
  db.close();
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(dbFile + suffix, { force: true });
});

function item(id: string, sourceId: string, publishedAt?: string): SourceItem {
  return {
    id,
    sourceId,
    title: id,
    summary: "",
    content: "",
    link: `https://example.test/${id}`,
    ...(publishedAt ? { publishedAt } : {}),
  };
}

await db.addItems([
  item("a1", "alpha", "2026-07-19T00:00:00.000Z"), // before the dispatch
  item("a2", "alpha", "2026-07-21T00:00:00.000Z"),
  item("a3", "alpha", "2026-07-22T12:00:00.000Z"),
  item("b1", "beta", "2026-07-23T00:00:00.000Z"),
  item("b2", "beta"), // undated — cannot prove it is new
  item("b3", "beta", "Wed, 02 Oct 2026 13:00:00 GMT"), // a feed date ingest could not parse
  item("c1", "gamma", "2026-08-01T00:00:00.000Z"), // dated in the future
  item("z1", "zeta", "2026-07-24T00:00:00.000Z"), // never asked about
]);

const SETTLED = "2026-07-20T00:00:00.000Z";
const NOW = "2026-07-25T00:00:00.000Z";

describe("countItemsPublishedBetween", () => {
  it("counts only posts inside the window, per source", async () => {
    expect(await db.countItemsPublishedBetween(["alpha", "beta"], SETTLED, NOW)).toEqual({
      alpha: 2, // a1 predates the dispatch
      beta: 1, // b2 undated, b3 unparseable
    });
  });

  it("leaves a source with nothing new out rather than reporting zero", async () => {
    const counts = await db.countItemsPublishedBetween(["alpha"], "2026-07-23T00:00:00.000Z", NOW);
    expect(counts).toEqual({});
  });

  it("excludes posts dated after the window's end", async () => {
    expect(await db.countItemsPublishedBetween(["gamma"], SETTLED, NOW)).toEqual({});
    expect(await db.countItemsPublishedBetween(["gamma"], SETTLED, "2026-09-01T00:00:00.000Z"))
      .toEqual({ gamma: 1 });
  });

  it("never leaks a source that was not asked for", async () => {
    expect(await db.countItemsPublishedBetween(["alpha"], SETTLED, NOW)).not.toHaveProperty("zeta");
  });

  it("is an empty result, not a query, for no sources", async () => {
    expect(await db.countItemsPublishedBetween([], SETTLED, NOW)).toEqual({});
  });
});

describe("newestItemDates", () => {
  it("returns the newest ISO date per source", async () => {
    expect(await db.newestItemDates(["alpha", "beta"])).toEqual({
      alpha: "2026-07-22T12:00:00.000Z",
      beta: "2026-07-23T00:00:00.000Z", // NOT the RFC-822 row, which sorts above every ISO string
    });
  });

  it("omits a source whose items carry no usable date", async () => {
    await db.addItems([item("d1", "delta"), item("d2", "delta", "not a date")]);
    expect(await db.newestItemDates(["delta"])).toEqual({});
  });

  it("omits a source with no items at all", async () => {
    expect(await db.newestItemDates(["nobody"])).toEqual({});
  });

  it("is an empty result for no sources", async () => {
    expect(await db.newestItemDates([])).toEqual({});
  });
});
