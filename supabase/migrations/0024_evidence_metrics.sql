-- Additive evidence telemetry for completed dispatches.
--
-- NULL means the historical run predates the evidence ledger and is deliberately excluded from
-- grounding-rate samples. Counts are persisted separately from the public JSON receipt so the
-- dashboard never has to transfer every paid-content evidence excerpt to calculate three totals.

alter table public.query_runs
  add column if not exists evidence_claim_count integer;
alter table public.query_runs
  add column if not exists grounded_claim_count integer;
alter table public.query_runs
  add column if not exists rewarded_citation_count integer;

alter table public.query_runs
  drop constraint if exists query_runs_evidence_counts_nonnegative_check;
alter table public.query_runs
  add constraint query_runs_evidence_counts_nonnegative_check
  check (
    (evidence_claim_count is null or evidence_claim_count >= 0)
    and (grounded_claim_count is null or grounded_claim_count >= 0)
    and (rewarded_citation_count is null or rewarded_citation_count >= 0)
    and (
      evidence_claim_count is null
      or grounded_claim_count is null
      or grounded_claim_count <= evidence_claim_count
    )
  );
