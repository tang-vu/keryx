import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { operatorInventorySchema, type OperatorInventory } from "./contracts";

export const operatorInventoryInputSchema = z.object({ network: z.enum(["eip155:5042", "eip155:5042002"]),
  payee: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(value => value.toLowerCase()),
  nowMs: z.number().int().nonnegative().max(8_640_000_000_000_000),
}).strict();
export type OperatorInventoryInput = z.input<typeof operatorInventoryInputSchema>;

/** One aggregate database statement over ALL unfinished public prepaid originals.
 * Caps are retained worst-case service obligations, not already-earned creator debt.
 * A foreign/malformed order blocks admission instead of disappearing from a slice. */
export function readSqliteOperatorInventory(db: DatabaseSync, raw: OperatorInventoryInput, selectedNetwork: string): OperatorInventory {
  const input = operatorInventoryInputSchema.parse(raw);
  if (input.network !== selectedNetwork) throw new Error("Operator inventory network mismatch");
  const observedAt = new Date(input.nowMs).toISOString();
  const reviewBefore = new Date(input.nowMs - 15 * 60_000).toISOString();
  const row = db.prepare(`WITH obligations AS (
    SELECT started_at, ROUND(creator_budget_usdc*1000000) cap,
      CASE WHEN lower(payee)!=? OR request_data IS NULL OR NOT json_valid(request_data)
        OR COALESCE(json_extract(CASE WHEN json_valid(request_data) THEN request_data ELSE '{}' END,'$.network'),'eip155:5042002')!=?
        OR json_type(CASE WHEN json_valid(request_data) THEN request_data ELSE '{}' END)!='object'
        OR creator_budget_usdc<=0 OR creator_budget_usdc>1000000
        OR creator_budget_usdc!=ROUND(creator_budget_usdc*1000000)/1000000.0
        OR (started_at IS NOT NULL AND (julianday(started_at) IS NULL OR julianday(started_at)>julianday(?)))
        OR transaction_id IS NULL OR trim(transaction_id)=''
        THEN 1 ELSE 0 END invalid
    FROM a2a_orders WHERE status='running'
  ), monthly_json AS (
    SELECT m.id, CASE WHEN json_valid(m.data) THEN m.data ELSE '{}' END data,
      (SELECT COUNT(*) FROM research_monthly_redemptions r WHERE r.monthly_id=m.id) used
      FROM research_monthly m
  ), prepaid AS (
    SELECT 4-used remaining, json_extract(data,'$.creatorBudgetMicros') cap,
      CASE WHEN json_type(data)!='object' OR lower(json_extract(data,'$.payee')) IS NOT ?
        OR COALESCE(json_extract(data,'$.network'),'eip155:5042002')!=?
        OR json_type(data,'$.creatorBudgetMicros') IS NOT 'integer'
        OR json_extract(data,'$.creatorBudgetMicros')<=0 OR json_extract(data,'$.creatorBudgetMicros')>1000000000000
        OR julianday(json_extract(data,'$.expiresAt')) IS NULL
        OR julianday(json_extract(data,'$.createdAt')) IS NULL
        OR julianday(json_extract(data,'$.createdAt'))>julianday(?)
        OR json_type(data,'$.transaction') IS NOT 'text' OR trim(json_extract(data,'$.transaction'))=''
        OR used>4 THEN 1 ELSE 0 END invalid,
      julianday(json_extract(data,'$.expiresAt'))>julianday(?) active
      FROM monthly_json
  ) SELECT COUNT(*) total,
    COALESCE(SUM(CASE WHEN started_at IS NULL THEN 1 ELSE 0 END),0) queued,
    COALESCE(SUM(CASE WHEN julianday(started_at)>julianday(?) THEN 1 ELSE 0 END),0) processing,
    COALESCE(SUM(CASE WHEN started_at IS NOT NULL AND (julianday(started_at)<=julianday(?) OR julianday(started_at) IS NULL) THEN 1 ELSE 0 END),0) review,
    COALESCE(SUM(invalid),0)+(SELECT COALESCE(SUM(invalid),0) FROM prepaid) invalid,
    COALESCE(SUM(CASE WHEN started_at IS NULL THEN cap ELSE 0 END),0) queued_cap,
    COALESCE(SUM(CASE WHEN started_at IS NOT NULL THEN cap ELSE 0 END),0) unfinished_cap,
    (SELECT COALESCE(SUM(CASE WHEN active THEN remaining ELSE 0 END),0) FROM prepaid) prepaid_requests,
    (SELECT COALESCE(SUM(CASE WHEN active THEN remaining*cap ELSE 0 END),0) FROM prepaid) prepaid_cap,
    MAX(COALESCE(MAX(CASE WHEN started_at IS NULL THEN cap ELSE 0 END),0),
      (SELECT COALESCE(MAX(CASE WHEN active AND remaining>0 THEN cap ELSE 0 END),0) FROM prepaid)) largest_cap
    FROM obligations`).get(input.payee, input.network, observedAt, input.payee, input.network, observedAt, observedAt, reviewBefore, reviewBefore) as Record<string, unknown>;
  return operatorInventorySchema.parse({ observedAt, network: input.network,
    queuedJobs: Number(row.queued), processingJobs: Number(row.processing), reviewRequiredJobs: Number(row.review), invalidJobs: Number(row.invalid),
    queuedCreatorMicroUsdc: String(row.queued_cap), unfinishedCreatorMicroUsdc: String(row.unfinished_cap),
    prepaidRequests: Number(row.prepaid_requests), prepaidCreatorMicroUsdc: String(row.prepaid_cap), largestCreatorMicroUsdc: String(row.largest_cap) });
}
