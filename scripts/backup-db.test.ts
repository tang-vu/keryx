/**
 * Unit test for the backup snapshot-rotation logic. The filesystem/VACUUM path is exercised by
 * running `npm run backup`; this locks the pure "which snapshots to prune" rule that decides what
 * gets deleted — the part where an off-by-one would silently discard a good backup.
 */

import { describe, it, expect } from "vitest";
import { prunable } from "./backup-rotation";

describe("prunable — snapshot rotation", () => {
  const snap = (t: string) => `keryx-${t}.sqlite.gz`;
  const names = [
    snap("2026-07-01T10-00-00-000Z"),
    snap("2026-07-01T11-00-00-000Z"),
    snap("2026-07-01T12-00-00-000Z"),
    snap("2026-07-01T13-00-00-000Z"),
  ];

  it("keeps the newest N and returns the rest oldest-included", () => {
    const stale = prunable(names, 2);
    expect(stale).toEqual([snap("2026-07-01T11-00-00-000Z"), snap("2026-07-01T10-00-00-000Z")]);
  });

  it("returns nothing when there are fewer snapshots than the keep count", () => {
    expect(prunable(names, 10)).toEqual([]);
  });

  it("ignores unrelated files (logs, temp dirs, other extensions)", () => {
    const mixed = [...names, "backup.log", "keryx-2026-07-01T09-00-00-000Z.sqlite", "notes.txt"];
    const stale = prunable(mixed, 4);
    expect(stale).toEqual([]); // exactly 4 real snapshots, keep 4 → prune none
    expect(stale.some((f) => !f.endsWith(".sqlite.gz"))).toBe(false);
  });
});
