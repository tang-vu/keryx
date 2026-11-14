import { z } from "zod";
import { accountHistoryItem } from "../../a2a/account-history";
import { retainedRecoveryMatches } from "../../a2a/overdue-escalation-queue";
import { PendingOwnerAdmissionError } from "../../a2a/pending-owner-association";
import { capturePostgresPendingOwnerSession, type PendingOwnerSessionProof } from "../../a2a/pending-owner-session";
import type { A2aOrder } from "../../a2a/order";
import type { PendingJobOwnersStore, OwnedPendingJob } from "../pending-job-owners-sqlite";
import { validateStorageIdentity, type StorageIdentity } from "../storage-identity";
import type { PostgresDomainChannel } from "./domain-channel";

const unavailable = () => new PendingOwnerAdmissionError("owner_association_unavailable");
const idSchema = z.string().regex(/^a2a_[a-f0-9]{64}$/);
const date = z.string().max(64).datetime({ offset: true });
const cursorSchema = z.object({ createdAt: date, id: idSchema }).strict();
const rowSchema = z.object({
  id: idSchema, query_id: idSchema, status: z.enum(["running", "failed", "completed"]),
  created_at: date, updated_at: date, started_at: date.nullable(),
  amount_usdc: z.number().finite(), creator_budget_usdc: z.number().finite(), service_fee_usdc: z.number().finite(),
  research_mode: z.enum(["quick", "deep"]), package_data: z.string().max(8192).nullable(),
  transaction_id: z.string().max(256), execution_journal_version: z.literal(1).nullable(),
  payment_started_at: date.nullable(), result_saving_at: date.nullable(), error_code: z.string().max(512).nullable(),
  worker_id: z.string().max(256).nullable(), payee: z.string().length(42).nullable(),
}).strict();
const listSchema = z.object({ rows: z.array(rowSchema).max(26), recovery: z.string().max(2048).nullable(),
  observedAtMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict();

/** Fixed metadata observations only. Composition confers neither installed
 * adapter provenance nor association/insertion authority. The genuine factory
 * must wrap both hooks in its own fresh local entry/authority checks. */
export function composePostgresPendingJobOwners(channel: PostgresDomainChannel, rawIdentity: StorageIdentity,
  readOnly: boolean): PendingJobOwnersStore {
  const identity = validateStorageIdentity(rawIdentity);
  if (typeof readOnly !== "boolean" || identity.authorityMode !== "mainnet-real") throw unavailable();
  // One bit of per-call sequencing, consumed by the immediately following
  // synchronous hook. No session row, admission verdict or TTL is cached.
  const completed = new WeakMap<object, true>();
  const live = () => { if (channel.closed) throw unavailable(); };
  const admission = (proof: PendingOwnerSessionProof) => {
    live(); if (readOnly) throw unavailable();
    return capturePostgresPendingOwnerSession(proof, identity, "admit");
  };
  return Object.freeze({
    // This is deliberately synchronous. Its native durable counterpart is a
    // separate explicitly awaited phase, never a Promise in this legacy hook.
    assertAdmission(proof: PendingOwnerSessionProof) {
      admission(proof);
      const ready = completed.get(proof); completed.delete(proof);
      if (!ready) throw unavailable();
    },
    async assertAdmissionAsync(proof: PendingOwnerSessionProof) {
      const packet = admission(proof), wire = JSON.stringify(packet);
      completed.delete(proof);
      const result = await channel.call("pendingOwnerAdmission", [wire]);
      live(); if (result !== true) throw unavailable();
      // Expiry/configuration/disposal may change while the observation waits.
      admission(proof);
      completed.set(proof, true);
    },
    async list(proof: PendingOwnerSessionProof, before?: { createdAt: string; id: string }, id?: string): Promise<OwnedPendingJob[]> {
      live();
      const session = capturePostgresPendingOwnerSession(proof, identity, "read");
      const capturedCursor = before === undefined ? null : cursorSchema.parse(before);
      const cursor = capturedCursor === null ? null : JSON.stringify(capturedCursor);
      const selected = id === undefined ? null : idSchema.parse(id);
      const result = await channel.call("pendingOwnerList", [JSON.stringify(session), cursor, selected]);
      live(); const value = listSchema.parse(result);
      let recovery: unknown = null;
      try { recovery = value.recovery === null ? null : JSON.parse(value.recovery); } catch { /* Unknown stays unknown. */ }
      const jobs: OwnedPendingJob[] = value.rows.map(row => {
        if (row.id !== row.query_id || selected !== null && row.id !== selected
          || capturedCursor && !(row.created_at < capturedCursor.createdAt || row.created_at === capturedCursor.createdAt && row.id < capturedCursor.id)) throw unavailable();
        const original = { id: row.id, queryId: row.query_id, status: row.status, createdAt: row.created_at,
          updatedAt: row.updated_at, startedAt: row.started_at, amountUsdc: row.amount_usdc,
          creatorBudgetUsdc: row.creator_budget_usdc, serviceFeeUsdc: row.service_fee_usdc, researchMode: row.research_mode,
          researchPackage: row.package_data === null ? null : JSON.parse(row.package_data),
          executionJournalVersion: row.execution_journal_version, paymentStartedAt: row.payment_started_at,
          resultSavingAt: row.result_saving_at, errorCode: row.error_code, request: null,
          workerId: row.worker_id, payee: row.payee, transaction: row.transaction_id, response: null, resolution: null } as A2aOrder;
        const held = retainedRecoveryMatches({ ...original, request: { network: identity.network } } as A2aOrder,
          recovery, row.payee === null ? undefined : { network: identity.network, payee: row.payee }, value.observedAtMs);
        const item = accountHistoryItem(original, value.observedAtMs, null, held);
        return { ...item, originalPayment: { ...item.originalPayment, network: "eip155:5042" as const },
          attention: row.status === "failed" || held ? "needs_review" : "unknown", recoveryState: held ? "held" : "unknown" };
      });
      capturePostgresPendingOwnerSession(proof, identity, "read"); live(); return jobs;
    },
  } satisfies PendingJobOwnersStore);
}
