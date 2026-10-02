import { expect, it } from "vitest";
import { postgresSnapshotDiagnosticChanges, postgresSnapshotDiagnosticSql } from "./postgres-snapshot-diagnostics.mjs";
it("reports changed witness names and hashes only while retaining the sealed full catalog selection", () => {
  const before = { tables: { original: "aa", untouched: "bb" }, catalog: { relation: "cc" }, relationFields: { "public.original.relhasindex": "dd" } };
  const after = { tables: { original: "ee", untouched: "bb" }, catalog: { relation: "ff" }, relationFields: { "public.original.relhasindex": "gg" } };
  expect(postgresSnapshotDiagnosticChanges(before, after)).toEqual({ tables: [{ name: "original", beforeSha256: "aa", afterSha256: "ee" }],
    catalog: [{ name: "relation", beforeSha256: "cc", afterSha256: "ff" }], relationFields: [{ name: "public.original.relhasindex", beforeSha256: "dd", afterSha256: "gg" }] });
  expect(postgresSnapshotDiagnosticSql).toContain("record_send(r)");
  expect(postgresSnapshotDiagnosticSql).toContain("from pg_auth_members m");
  expect(postgresSnapshotDiagnosticSql).toContain("from pg_index i");
});
