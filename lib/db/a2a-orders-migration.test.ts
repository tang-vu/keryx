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
const resolutionMigration = fs.readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/0040_a2a_operator_resolution.sql"),
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

  it("resolves terminal metadata only with saved-run or no-payment boundary evidence", () => {
    expect(resolutionMigration).toContain("resolution_data jsonb");
    expect(resolutionMigration).toContain("execution_journal_version smallint");
    expect(resolutionMigration).toContain("payment_started_at timestamptz");
    expect(resolutionMigration).toContain("result_saving_at timestamptz");
    expect(resolutionMigration).toContain("mark_a2a_payment_started");
    expect(resolutionMigration).toContain("mark_a2a_result_saving");
    expect(resolutionMigration).toContain("orders.execution_journal_version = 1");
    expect(resolutionMigration).toContain("orders.payment_started_at IS NULL");
    expect(resolutionMigration).toContain("orders.result_saving_at IS NULL");
    expect(resolutionMigration).toContain("runs.payment_mode = 'real'");
    expect(resolutionMigration).toContain("NOT EXISTS (");
    expect(resolutionMigration).toContain("payments.settlement_status");
    expect(resolutionMigration).toContain("current_creator_payments");
    expect(resolutionMigration).toContain("(SELECT attempts FROM live_evidence) = evidence_attempts");
    expect(resolutionMigration).toContain("orders.started_at <= p_started_before");
    expect(resolutionMigration).toContain("SECURITY DEFINER");
    expect(resolutionMigration).toContain(
      "REVOKE ALL ON FUNCTION public.resolve_a2a_order(text, text, jsonb, text, jsonb, timestamptz)",
    );
    expect(resolutionMigration).toContain("TO service_role");
    expect(resolutionMigration).toContain(
      "REVOKE ALL ON FUNCTION public.mark_a2a_payment_started(text, timestamptz)",
    );
    expect(resolutionMigration).toContain(
      "REVOKE ALL ON FUNCTION public.mark_a2a_result_saving(text, timestamptz)",
    );
  });
});
