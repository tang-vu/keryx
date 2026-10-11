import { expect, it } from "vitest";
import { observeBrowserPublicUsage } from "../../test-support/browser-public-usage-observations";

/** Harness fault injection only. Actual migration/ACL/SQL acceptance requires hosted PG17. */
function fixture(fault?: "body" | "window" | "partial" | "write" | "acl" | "public" | "native" | "native-error") {
  const calls: string[] = [], markers = new Set<string>();
  let observed = false;
  const sql = (statement: string, database: string) => {
    expect(database).toBe("owned-synthetic-ordinary"); calls.push(statement);
    if (statement.startsWith("insert into")) return "";
    if (statement.includes("select encode(sha256")) return (fault === "write" && observed ? "b" : "a").repeat(64);
    if (statement.includes("aclexplode")) return fault === "public" ? "t" : "f";
    if (statement.startsWith("create table")) { markers.add(statement.split(" ")[2].split("(")[0]); return ""; }
    if (statement.startsWith("drop table")) { markers.delete(statement.split(" ")[2].replace(";", "")); return ""; }
    if (statement.startsWith("create schema") || statement.startsWith("drop schema")) return "";
    if (statement.includes("public_usage_window_v1")) {
      expect(statement).toMatch(/^begin read only; set local role (service_role|anon|authenticated);/);
      expect(statement.trimEnd()).toMatch(/commit;$/);
      if (!statement.includes("role service_role") && fault !== "acl") throw Error("permission denied for function public_usage_window_v1");
      if (markers.size && fault !== "native") throw Error(fault === "native-error" ? "unrelated native error" : "usage_unavailable");
      observed = true;
      const window = { network: "eip155:5042002", period: "custom", since: "2026-10-01T00:00:00.000Z", until: "2026-10-02T00:00:00.000Z" };
      return JSON.stringify({ complete: fault !== "partial", window: fault === "window" ? { ...window, network: "eip155:5042" } : window,
        runs: [{ id: "browser-usage-in-window", createdAt: window.since, usage: null, provenance: null, actorId: null,
          ...(fault === "body" ? { answer: "Synthetic answer never returned" } : {}) }], payments: [] });
    }
    throw Error(`Unexpected synthetic fixture statement: ${statement}`);
  };
  return { sql, calls, markers };
}

it("observes a bounded ordinary read and both later native markers without broadening authority", () => {
  const f = fixture(); observeBrowserPublicUsage(f.sql, "owned-synthetic-ordinary");
  expect(f.markers.size).toBe(0);
  expect(f.calls.filter(statement => statement.startsWith("create table"))).toEqual([
    "create table public.keryx_storage_identity(synthetic_marker text);",
    "create table keryx_storage.identity(synthetic_marker text);",
  ]);
  expect(f.calls.some(statement => /\b(?:grant|update|delete|alter)\b/i.test(statement))).toBe(false);
});

it.each(["body", "window", "partial", "write", "acl", "public", "native", "native-error"] as const)(
  "rejects an unqualified %s observation rather than silently accepting the fixture", fault => {
    const f = fixture(fault);
    expect(() => observeBrowserPublicUsage(f.sql, "owned-synthetic-ordinary")).toThrow();
    expect(f.markers.size).toBe(0);
  });
