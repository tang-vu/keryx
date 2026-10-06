/** Additive private recovery journal. Existing enrolled stores require an explicit reviewed
 * migration plus writer fences; application startup never installs this schema. */
export const A2A_FULFILLMENT_SQL = `
CREATE TABLE IF NOT EXISTS a2a_failed_original_fulfillments (
  original_id TEXT PRIMARY KEY REFERENCES a2a_orders(id),
  claim_id TEXT NOT NULL UNIQUE,
  authority_data TEXT NOT NULL CHECK(json_valid(authority_data)),
  failed_order_data TEXT NOT NULL CHECK(json_valid(failed_order_data)),
  claimed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS a2a_fulfillment_completions (
  original_id TEXT PRIMARY KEY REFERENCES a2a_failed_original_fulfillments(original_id),
  claim_id TEXT NOT NULL UNIQUE,
  run_sha256 TEXT NOT NULL,
  provider_ledger_sha256 TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS a2a_failed_fulfillment_retained_update BEFORE UPDATE ON a2a_failed_original_fulfillments
  BEGIN SELECT RAISE(ABORT,'original fulfillment claim retained'); END;
CREATE TRIGGER IF NOT EXISTS a2a_failed_fulfillment_retained_delete BEFORE DELETE ON a2a_failed_original_fulfillments
  BEGIN SELECT RAISE(ABORT,'original fulfillment claim retained'); END;
CREATE TRIGGER IF NOT EXISTS a2a_fulfillment_completion_retained_update BEFORE UPDATE ON a2a_fulfillment_completions
  BEGIN SELECT RAISE(ABORT,'original fulfillment completion retained'); END;
CREATE TRIGGER IF NOT EXISTS a2a_fulfillment_completion_retained_delete BEFORE DELETE ON a2a_fulfillment_completions
  BEGIN SELECT RAISE(ABORT,'original fulfillment completion retained'); END;
`;
