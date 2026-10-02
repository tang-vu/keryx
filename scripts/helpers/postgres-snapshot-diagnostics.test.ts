import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { normalizeFundingSnapshotMigration, postgresSnapshotDiagnosticChanges, postgresSnapshotDiagnosticSql } from "./postgres-snapshot-diagnostics.mjs";
it("reports changed witness names and hashes only while retaining the installed full catalog selection", () => {
  const before = { tables: { original: "aa", untouched: "bb" }, catalog: { relation: "cc" }, relationFields: { "public.original.relhasindex": "dd" } };
  const after = { tables: { original: "ee", untouched: "bb" }, catalog: { relation: "ff" }, relationFields: { "public.original.relhasindex": "gg" } };
  expect(postgresSnapshotDiagnosticChanges(before, after)).toEqual({ tables: [{ name: "original", beforeSha256: "aa", afterSha256: "ee" }],
    catalog: [{ name: "relation", beforeSha256: "cc", afterSha256: "ff" }], relationFields: [{ name: "public.original.relhasindex", beforeSha256: "dd", afterSha256: "gg" }] });
  expect(postgresSnapshotDiagnosticSql).toContain("record_send(r)");
  expect(postgresSnapshotDiagnosticSql).toContain("from pg_auth_members m");
  expect(postgresSnapshotDiagnosticSql).toContain("from pg_index i");
  expect(postgresSnapshotDiagnosticSql).toContain("convert_to(c::text");
  expect(postgresSnapshotDiagnosticSql).toContain("to_jsonb(c) fields");
  expect(postgresSnapshotDiagnosticSql).not.toContain("array['relpages'");
});

it("aligns only the five reviewed physical fields while preserving the complete fixture", () => {
  const source = readFileSync(new URL("../test-fixtures/funding-postgres/0074_storage_owner_enrollment.sql", import.meta.url), "utf8");
  const original = "union all select 'relation:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_class c";
  const normalized = "union all select 'relation:'||encode(sha256(convert_to((to_jsonb(c)-array['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'])::text,'UTF8')),'hex') from pg_class c";
  expect(normalizeFundingSnapshotMigration(source)).toBe(source.replace(original, normalized));
  expect(normalizeFundingSnapshotMigration("select 1;")).toBe("select 1;");
  expect(() => normalizeFundingSnapshotMigration(source.replace(original, "unexpected"))).toThrow("source mismatch");
});
