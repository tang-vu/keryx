import type { DatabaseSync, SQLOutputValue } from "node:sqlite";
import { calculateDashboardMetrics, type MetricPaymentRow, type MetricRunRow,
  type MetricFeedbackRow, type MetricGapIntentRow } from "./dashboard-metrics";

// One fixed read snapshot, no joins/deduplication or JSON representation. Native
// values and integer-read errors cross the same guarded prepare/all operations.
// Column0 tags the source; columns1..12 keep each original SELECT's field order.
const INPUT_ROWS = `SELECT 0 AS metric_group,amount_usdc,source_id,query_id,kind,origin,settled,settlement_status,payer,tx_hash,NULL,NULL,NULL
  FROM payment_events
  UNION ALL SELECT 1,id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count
  FROM query_runs
  UNION ALL SELECT 2,query_id,rating,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
  FROM answer_feedback
  UNION ALL SELECT 3,status,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL
  FROM gap_intents`;

/** Internal fixed read for the enrolled facade. Its existing before/after
 * admission and the verified connection's fresh SQL guards remain authoritative.
 * No result, statement or successful admission survives this operation. */
export async function readSqliteDashboardMetrics(db: DatabaseSync) {
  const statement = db.prepare(INPUT_ROWS);
  // This is statement-local (Node>=22.16), not a connection policy change. Dense
  // arrays avoid creating padded named-property objects for the UNION rows.
  statement.setReturnArrays(true);
  const rows = statement.all() as unknown as SQLOutputValue[][];
  const payments: MetricPaymentRow[] = [], runs: MetricRunRow[] = [];
  const feedback: MetricFeedbackRow[] = [], gapIntents: MetricGapIntentRow[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 13) throw new Error("Unexpected dashboard metric row layout");
    switch (Number(row[0])) {
      case 0:
        payments.push({ amountUsdc: Number(row[1]), sourceId: String(row[2] ?? ""), queryId: String(row[3] ?? ""),
          kind: row[4] as MetricPaymentRow["kind"], origin: (row[5] as MetricPaymentRow["origin"]) ?? null,
          settled: Number(row[6]) === 1, settlementStatus: (row[7] as MetricPaymentRow["settlementStatus"]) ?? null,
          payer: (row[8] as string | null) ?? null, txHash: (row[9] as string | null) ?? null });
        break;
      case 1:
        runs.push({ id: String(row[1]), origin: (row[2] as MetricRunRow["origin"]) ?? null,
          asker: (row[3] as string | null) ?? null, durationMs: row[4] == null ? null : Number(row[4]),
          paymentMode: (row[5] as MetricRunRow["paymentMode"]) ?? null,
          paymentAttempts: row[6] == null ? null : Number(row[6]), settledPayments: row[7] == null ? null : Number(row[7]),
          confidenceLevel: (row[8] as MetricRunRow["confidenceLevel"]) ?? null, mcpClient: (row[9] as MetricRunRow["mcpClient"]) ?? null,
          evidenceClaimCount: row[10] == null ? null : Number(row[10]), groundedClaimCount: row[11] == null ? null : Number(row[11]),
          rewardedCitationCount: row[12] == null ? null : Number(row[12]) });
        break;
      case 2:
        feedback.push({ queryId: String(row[1]), rating: row[2] as MetricFeedbackRow["rating"] });
        break;
      case 3:
        gapIntents.push({ status: row[1] as MetricGapIntentRow["status"] });
        break;
      default: throw new Error("Unexpected dashboard metric source");
    }
  }
  let recordedAccounts: number | null = null;
  try {
    // Preserve the existing separate optional account-index error boundary.
    const row = db.prepare(`SELECT COUNT(DISTINCT LOWER(wallet_address)) AS n FROM users
      WHERE typeof(wallet_address)='text' AND length(wallet_address)=42
        AND lower(substr(wallet_address,1,2))='0x'
        AND substr(wallet_address,3) NOT GLOB '*[^0-9a-fA-F]*'`).get();
    const count = row?.n;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) recordedAccounts = count;
  } catch { /* Account-index availability is independent from research/payment metrics. */ }
  return { ...calculateDashboardMetrics(payments, runs, feedback, gapIntents), recordedAccounts };
}
