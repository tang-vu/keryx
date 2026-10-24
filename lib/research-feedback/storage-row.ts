import { FeedbackError, feedbackRowSchema, type RequesterFeedback } from "./contracts";
import { requesterFeedbackId } from "./service";

export function feedbackStorageRow(raw: RequesterFeedback) {
  const row = feedbackRowSchema.parse(raw);
  return { id: requesterFeedbackId(row.runId, row.deliveredDigest), run_id: row.runId,
    delivered_digest: row.deliveredDigest, data: JSON.stringify(row), created_at: row.submittedAt };
}
export function readFeedbackStorageRow(raw: unknown, expectedId: string): RequesterFeedback | null {
  if (raw === null || raw === undefined) return null;
  try {
    const value = raw as Record<string, unknown>;
    if (typeof value.data !== "string" || value.data.length > 8192) throw new Error();
    const row = feedbackRowSchema.parse(JSON.parse(value.data)), canonical = feedbackStorageRow(row);
    if (canonical.id !== expectedId || Object.keys(canonical).some(key => Reflect.get(canonical, key) !== value[key])) throw new Error();
    return row;
  } catch { throw new FeedbackError("feedback_unavailable"); }
}
