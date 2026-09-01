import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0038_a2a_orders.sql"),
  "utf8",
);
const asyncMigration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0039_async_a2a_jobs.sql"),
  "utf8",
);

describe("A2A order migration", () => {
  it("keeps orders private and constrains terminal states and money", () => {
    expect(migration).toContain("id text PRIMARY KEY");
    expect(migration).toContain("query_id text NOT NULL UNIQUE");
    expect(migration).toContain("request_hash text NOT NULL");
    expect(migration).toContain("CHECK (status IN ('running','completed','failed'))");
    expect(migration).toMatch(/amount_usdc numeric NOT NULL CHECK \(amount_usdc > 0\)/);
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE public.a2a_orders FROM anon, authenticated");
  });

  it("keeps worker input private and claims queued work atomically without retrying legacy rows", () => {
    expect(asyncMigration).toContain("request_data jsonb");
    expect(asyncMigration).toContain("started_at = updated_at");
    expect(asyncMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(asyncMigration).toContain("SECURITY DEFINER");
    expect(asyncMigration).toContain("AND request_data IS NOT NULL");
    expect(asyncMigration).toContain(
      "REVOKE ALL ON FUNCTION public.claim_a2a_order(text, timestamptz) FROM PUBLIC, anon, authenticated",
    );
    expect(asyncMigration).toContain(
      "GRANT EXECUTE ON FUNCTION public.claim_a2a_order(text, timestamptz) TO service_role",
    );
  });
});
