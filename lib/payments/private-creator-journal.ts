import type { KeryxDB } from "../db/keryx-db";
import { privateCreatorSubmissionSchema, type PrivateCreatorSubmission } from "../db/private-creator-submissions";
import type { PrivateCreatorConfirmationRecord } from "../db/private-creator-confirmations";
import type { ServerX402Attempt, ServerX402Submission } from "./server-x402-client";

type JournalDb = Pick<KeryxDB, "admitPrivateCreatorSubmission" | "confirmPrivateCreatorSubmission">;
type Context = { id: string; payer: string; workerId: string } & Pick<PrivateCreatorSubmission, "kind" | "sourceId" | "itemId">;
export type PrivateCreatorOutcome<T> = { attempt: ServerX402Attempt<T>; confirmation: PrivateCreatorConfirmationRecord | null;
  journalStatus: "pending" | "confirmed" | "confirmation-unpersisted" | "receipt-mismatch" };

/** Trusted gateway adapter only: caller must validate source payout and obtain a fresh worker claim. */
export function privateCreatorJournal(db: JournalDb, context: Context) {
  const { id, payer, workerId, kind, sourceId, itemId } = { ...context };
  let started = false;
  let admitted: PrivateCreatorSubmission["submission"] | undefined;
  return {
    async beforeSubmit(submission: Readonly<ServerX402Submission>) {
      if (started) throw new Error("Private creator journal already used");
      started = true; // An uncertain admission is never reset for a new signed request.
      const parsed = privateCreatorSubmissionSchema.safeParse({ kind, sourceId, itemId, submission });
      if (!parsed.success) throw new Error("Invalid private creator submission");
      if (!await db.admitPrivateCreatorSubmission(id, payer, workerId, parsed.data)) throw new Error("Private creator submission not admitted");
      admitted = parsed.data.submission;
    },
    async recordOutcome<T>(value: ServerX402Attempt<T>): Promise<PrivateCreatorOutcome<T>> {
      const attempt = { ...value }; // Retain observed receipt fields across any asynchronous DB failure.
      if (!admitted || attempt.authorizationId.toLowerCase() !== admitted.authorizationId
        || attempt.authorizationExpiresAt !== admitted.authorizationExpiresAt
        || attempt.amountUsdc !== Number(admitted.amountMicros) / 1e6) {
        return { attempt, confirmation: null, journalStatus: "receipt-mismatch" };
      }
      if (attempt.settlementStatus !== "settled") return { attempt, confirmation: null, journalStatus: "pending" };
      if (!attempt.transaction) return { attempt, confirmation: null, journalStatus: "receipt-mismatch" };
      try {
        const confirmation = await db.confirmPrivateCreatorSubmission(id, payer, workerId, {
          source: "circle-facilitator-success", transaction: attempt.transaction, submission: { ...admitted },
        });
        return { attempt, confirmation, journalStatus: "confirmed" };
      } catch {
        // No logging of private context, no re-signing, no loss/reclassification of observed settlement.
        return { attempt, confirmation: null, journalStatus: "confirmation-unpersisted" };
      }
    },
  };
}
