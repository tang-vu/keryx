import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0034_private_data_hardening.sql"),
  "utf8",
);

describe("Supabase private-data hardening migration", () => {
  it("creates the adapter parity tables", () => {
    expect(migration).toContain("create table if not exists public.answer_feedback");
    expect(migration).toContain("create table if not exists public.query_memories");
  });

  it("enables RLS, revokes client writes, and closes RPC execution", () => {
    for (const table of [
      "api_keys",
      "source_notify",
      "source_notify_email",
      "session_grants",
      "rate_limit_counters",
      "answer_feedback",
      "query_memories",
    ]) {
      expect(migration).toMatch(new RegExp(`['\"]${table}['\"]`));
    }
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.%I from anon, authenticated");
    expect(migration).toContain(
      "revoke execute on all functions in schema public from public, anon, authenticated",
    );
  });

  it("purges secret-bearing legacy rate-limit buckets", () => {
    expect(migration).toContain("where bucket like 'ask:kx\\_live\\_%'");
  });
});
