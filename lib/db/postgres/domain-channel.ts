import { Pool } from "pg";
import { canonicalJson } from "../../canonical-json";
import { validateStorageIdentity, type StorageIdentity } from "../storage-identity";
import { postgresPoolConfiguration, PostgresStorageBusy, PostgresStorageUnavailable, type PostgresConnectionOptions } from "./connection";
import { APPLICATION_READ_CALLS } from "./application-read-calls";
import { AUTH_WRITE_CALLS } from "./auth-write-calls";
import { OPERATIONAL_WRITE_CALLS } from "./operational-write-calls";
import { PRIVACY_CALLS } from './privacy-calls';
import { WORKSPACE_CALLS } from './workspace-calls';
import { CONTENT_WRITE_CALLS } from './content-write-calls';
import { REVIEW_CALLS } from './review-calls';
import { HEALTH_CALLS } from './health-calls';
import { USAGE_CALLS } from './usage-calls';
import { PUBLIC_LEDGER_CALLS } from './ledger-calls';
import { ACCEPTANCE_CALLS } from './acceptance-calls';
import { ACCOUNT_CALLS } from './accounts-calls';
import { CHAT_LINK_CALLS } from './chat-links-calls';
import { PUBLIC_PROFILE_CALLS } from './public-profiles-calls';
import { OWNER_ASSIGNMENT_CALLS } from './owner-assignments-calls';
import { SOURCE_OBSERVATION_CALLS } from './source-observation-calls';
import { ARTICLE_OFFER_CALLS } from './article-offer-transport';
import { OPERATOR_WITHDRAWAL_CALLS } from './operator-withdrawal-calls';

// Source-defined calls only: callers cannot supply SQL, function names, transaction
// callbacks, expected metadata, role changes or a connection to the runtime.
const CALLS = Object.freeze({
  referenceArchiveFrame:{sql:"SELECT public.storage_reference_archive($1::jsonb,$2::text,'frame',$3::text) AS result",args:1,write:false,bytes:134225920,inputBytes:1048576,transaction:true},
  referenceArchiveApply:{sql:"SELECT public.storage_reference_archive($1::jsonb,$2::text,'apply',$3::text) AS result",args:1,write:true,bytes:256,inputBytes:268443648},
  referenceArchiveRead:{sql:"SELECT public.storage_reference_archive($1::jsonb,$2::text,$3::text,$4::text) AS result",args:2,write:false,bytes:67117056,inputBytes:262144,transaction:true},
  paymentEventRecord:{sql:"SELECT public.storage_payment_events($1::jsonb,$2::text,'record',$3::text) AS result",args:1,write:true,bytes:64,inputBytes:16785408},
  paymentEventRecordOnce:{sql:"SELECT public.storage_payment_events($1::jsonb,$2::text,'record-once',$3::text) AS result",args:1,write:true,bytes:64,inputBytes:16785408},
  paymentEventSnapshot:{sql:"SELECT public.storage_payment_events($1::jsonb,$2::text,'snapshot',$3::text) AS result",args:1,write:false,bytes:6299648,inputBytes:32768,transaction:true},
  paymentEventTerminal:{sql:"SELECT public.storage_payment_events($1::jsonb,$2::text,'terminal',$3::text) AS result",args:1,write:true,bytes:256,inputBytes:16785408},
  browserJournalState:{sql:"SELECT public.storage_browser_journal_evidence($1::jsonb,$2::text,'state',$3::text) AS result",args:1,write:false,bytes:8396800,inputBytes:131072,transaction:true},
  browserJournalFinish:{sql:"SELECT public.storage_browser_journal_evidence($1::jsonb,$2::text,'finish',$3::text) AS result",args:1,write:false,bytes:8396800,inputBytes:131072,transaction:true},
  browserJournalControl:{sql:"SELECT public.storage_browser_journal_evidence($1::jsonb,$2::text,'control','{}') AS result",args:0,write:false,bytes:128,transaction:true},
  browserJournalAction:{sql:"SELECT public.storage_browser_journal($1::jsonb,$2::text,$3::text,$4::text) AS result",args:2,write:true,bytes:8396800,inputBytes:16785408},
  browserJournalReplay:{sql:"SELECT public.storage_browser_journal_evidence($1::jsonb,$2::text,$3::text,$4::text) AS result",args:2,write:false,bytes:8396800,inputBytes:16785408,transaction:true},
  a2aFulfillmentGet:{sql:"SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,'get',$3::text,NULL) AS result",args:1,write:false,transaction:true,bytes:33562624,inputBytes:512},
  a2aFulfillmentSnapshot:{sql:"SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,'snapshot',$3::text,NULL) AS result",args:1,write:false,transaction:true,bytes:67108864,inputBytes:512},
  a2aFulfillmentVerify:{sql:"SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,'verify',$3::text,$4::text) AS result",args:2,write:false,transaction:true,bytes:128,inputBytes:4096},
  a2aFulfillmentClaim:{sql:"SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,'claim',$3::text,$4::text) AS result",args:2,write:true,bytes:33562624,inputBytes:67112960},
  a2aFulfillmentComplete:{sql:"SELECT public.storage_a2a_fulfillment($1::jsonb,$2::text,'complete',$3::text,$4::text) AS result",args:2,write:true,bytes:128,inputBytes:134221824},
  sourceProducerSnapshot:{sql:"SELECT public.storage_source_producer($1::jsonb,$2::text,'snapshot',$3::text) AS result",args:1,write:false,transaction:true,bytes:16777216,inputBytes:131072},
  sourceProducerWrite:{sql:"SELECT public.storage_source_producer($1::jsonb,$2::text,'write',$3::text) AS result",args:1,write:true,bytes:32768,inputBytes:1064960},
  hostedSourcePolicySnapshot:{sql:"SELECT public.storage_hosted_admit_authorization($1::jsonb,$2::text,'source-policy-snapshot',NULL,$3::text,NULL,NULL,NULL) AS result",args:1,write:false,transaction:true,bytes:16777216,inputBytes:8192},
  sourceClaimsRead:{sql:"SELECT public.storage_hosted_admit_authorization($1::jsonb,$2::text,'source-claims-read',NULL,$3::text,NULL,NULL,NULL) AS result",args:1,write:false,transaction:true,bytes:16777216,inputBytes:8192},
  pendingOwnerAdmission:{sql:"SELECT public.storage_pending_owner_observe($1::jsonb,$2::text,'admission',$3::text,NULL,NULL) AS result",args:1,write:false,transaction:true,bytes:128},
  pendingOwnerList:{sql:"SELECT public.storage_pending_owner_observe($1::jsonb,$2::text,'list',$3::text,$4::text,$5::text) AS result",args:3,write:false,transaction:true,bytes:524288},
  researchPurchaseClaim:{sql:"SELECT public.storage_research_purchases($1::jsonb,$2::text,'claim',$3::text,NULL) AS result",args:1,write:true,bytes:64,inputBytes:262144},
  researchMonthlyCreate:{sql:"SELECT public.storage_research_purchases($1::jsonb,$2::text,'create',$3::text,NULL) AS result",args:1,write:true,bytes:65536,inputBytes:262144},
  researchMonthlyGet:{sql:"SELECT public.storage_research_purchases($1::jsonb,$2::text,'get',$3::text,NULL) AS result",args:1,write:false,transaction:true,bytes:262144,inputBytes:256},
  researchMonthlyRedeem:{sql:"SELECT public.storage_research_purchases($1::jsonb,$2::text,'redeem',$3::text,$4::text) AS result",args:2,write:true,bytes:4198400,inputBytes:262144},
  hostedAdmitAuthorization:{sql:'SELECT public.storage_hosted_admit_authorization($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::text) AS result',args:6,write:true,bytes:128},
  a2aOriginalSettled:{sql:"SELECT public.storage_a2a_original_observe($1::jsonb,$2::text,'settled',$3::text) AS result",args:1,write:false,bytes:128,transaction:true},
  a2aOriginalStore:{sql:"SELECT public.storage_a2a_original_observe($1::jsonb,$2::text,'store',NULL) AS result",args:0,write:false,bytes:256,transaction:true},
  a2aCreate:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'create',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:4198400,inputBytes:524288},
  a2aOriginalSnapshot:{sql:"SELECT public.storage_a2a_original_observe($1::jsonb,$2::text,'snapshot',$3::text) AS result",args:1,write:false,bytes:8388608,transaction:true},
  a2aResolveCompleted:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'repair',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:128,inputBytes:33554432},
  a2aResolveFailed:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'close',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:128,inputBytes:33554432},
  a2aComplete:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'complete',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:128,inputBytes:33554432},
  a2aOriginalUnfinished:{sql:"SELECT public.storage_a2a_original_observe($1::jsonb,$2::text,'queue',$3::text) AS result",args:1,write:false,bytes:4194304,transaction:true},
  a2aOriginalClaim:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'claim',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:4194304},
  a2aPaymentStart:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'payment-start',$3::text,NULL,$4::text) AS result",args:2,write:true,bytes:128},
  a2aResultSaving:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'result-saving',$3::text,NULL,$4::text) AS result",args:2,write:true,bytes:128},
  a2aFail:{sql:"SELECT public.storage_a2a_original_execution($1::jsonb,$2::text,'fail',$3::text,$4::text,$5::text) AS result",args:3,write:true,bytes:128},
  ...APPLICATION_READ_CALLS,
  ...AUTH_WRITE_CALLS,
  ...OPERATIONAL_WRITE_CALLS,
  ...PRIVACY_CALLS,
  ...WORKSPACE_CALLS,
  ...CONTENT_WRITE_CALLS,
  ...REVIEW_CALLS,
  ...HEALTH_CALLS,
  ...USAGE_CALLS,
  ...PUBLIC_LEDGER_CALLS,
  ...ACCEPTANCE_CALLS,
  ...ACCOUNT_CALLS,
  ...CHAT_LINK_CALLS,
  ...PUBLIC_PROFILE_CALLS,
  ...OWNER_ASSIGNMENT_CALLS,
  ...SOURCE_OBSERVATION_CALLS,
  ...ARTICLE_OFFER_CALLS,
  ...OPERATOR_WITHDRAWAL_CALLS,
  sourceItemByLink:{sql:'SELECT public.storage_source_item_by_link($1::jsonb,$2::text,$3::text,$4::text) AS result',args:2,write:false,bytes:4194304,transaction:true},
  ownershipHistoryList:{sql:"SELECT public.storage_ownership_history_list($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::integer,$8::jsonb,$9::jsonb) AS result",args:7,write:false,bytes:4198400,transaction:true},
  ownershipHistoryRead:{sql:"SELECT public.storage_ownership_history_read($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text) AS result",args:4,write:false,bytes:8008192,transaction:true},
  runClaimsReady:{sql:"SELECT public.storage_run_claims_ready($1::jsonb,$2::text) AS result",args:0,write:false,bytes:256,transaction:true},
  runClaimIssue:{sql:"SELECT public.storage_run_claim_issue($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text) AS result",args:5,write:true,bytes:8192},
  runClaimConsume:{sql:"SELECT public.storage_run_claim_consume($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text) AS result",args:5,write:true,bytes:8192},
  nativeRuntimeAuthority:{sql:"SELECT public.storage_native_runtime_authority($1::jsonb,$2::text) AS result",args:0,write:false,bytes:8192,transaction:true},
  nativeRuntimeColdRead:{sql:"SELECT public.storage_native_runtime_cold_read($1::jsonb,$2::text) AS result",args:0,write:false,bytes:12582912,transaction:true},
  personalHistoryList:{sql:"SELECT public.storage_personal_history_list($1::jsonb,$2::text,$3::text,$4::jsonb,$5::integer,$6::jsonb,$7::jsonb) AS result",args:5,write:false,bytes:4194304,transaction:true},
  personalHistoryReceipts:{sql:"SELECT public.storage_personal_history_receipts($1::jsonb,$2::text,$3::text,$4::integer) AS result",args:2,write:false,bytes:4194304,transaction:true},
  profileIdentityList:{sql:"SELECT public.storage_profile_identity_list($1::jsonb,$2::text,$3::text) AS result",args:1,write:false,bytes:8192,transaction:true},
  profileIdentityBegin:{sql:"SELECT public.storage_profile_identity_begin($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text) AS result",args:5,write:true,bytes:256},
  profileIdentityConsume:{sql:"SELECT public.storage_profile_identity_consume($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text) AS result",args:5,write:true,bytes:256},
  profileIdentityComplete:{sql:"SELECT public.storage_profile_identity_complete($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text,$8::jsonb) AS result",args:6,write:true,bytes:8192},
  profileIdentityUnlink:{sql:"SELECT public.storage_profile_identity_unlink($1::jsonb,$2::text,$3::text,$4::text) AS result",args:2,write:true,bytes:256},
  privateProfileGet:{sql:"SELECT public.storage_private_profile_get($1::jsonb,$2::text,$3::text,$4::text) AS result",args:2,write:false,bytes:65536,transaction:true},
  privateProfileUpdate:{sql:"SELECT public.storage_private_profile_update($1::jsonb,$2::text,$3::text,$4::jsonb) AS result",args:2,write:true,bytes:65536},
  privateProfileDelete:{sql:"SELECT public.storage_private_profile_delete($1::jsonb,$2::text,$3::text) AS result",args:1,write:true,bytes:128},
  dashboardMetrics:{sql:"SELECT public.storage_dashboard_metrics($1::jsonb,$2::text) AS result",args:0,write:false,bytes:4202496,transaction:true},
  issue: { sql: "SELECT public.storage_issue_session_grant_consent($1::jsonb,$2::text,$3::text) AS result", args: 1, write: true, bytes: 0 },
  consume: { sql: "SELECT public.storage_consume_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  get: { sql: "SELECT public.storage_get_session_grant_consent($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 16384 },
  funding: { sql: "SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 1024 },
  retained: { sql: "SELECT public.storage_browser_signer_retained_spend($1::jsonb,$2::text,$3::text) AS result", args: 1, write: false, bytes: 64 },
  withdrawalAccounting: { sql: "SELECT public.storage_session_withdrawal_accounting($1::jsonb,$2::text,$3::text) AS result", args: 1, write: false, bytes: 65536 },
  withdrawalRead: { sql: "SELECT public.storage_read_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 65536 },
  withdrawalPending: { sql: "SELECT public.storage_pending_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 65536 },
  withdrawalReserve: { sql: "SELECT public.storage_reserve_session_withdrawal($1::jsonb,$2::text,$3::text) AS result", args: 1, write: true, bytes: 0 },
  withdrawalExpose: { sql: "SELECT public.storage_expose_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  withdrawalCancel: { sql: "SELECT public.storage_cancel_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  withdrawalAbort: { sql: "SELECT public.storage_abort_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text) AS result", args: 4, write: true, bytes: 0 },
  withdrawalComplete: { sql: "SELECT public.storage_complete_session_withdrawal($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text) AS result", args: 4, write: true, bytes: 0 },
  creatorRead: { sql: "SELECT public.storage_creator_withdrawal_read($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 32768 },
  creatorHistory: { sql: "SELECT public.storage_creator_withdrawal_history($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text) AS result", args: 4, write: false, bytes: 524288 },
  creatorReserve: { sql: "SELECT public.storage_creator_withdrawal_reserve($1::jsonb,$2::text,$3::text) AS result", args: 1, write: true, bytes: 0 },
  creatorClaim: { sql: "SELECT public.storage_creator_withdrawal_claim($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text) AS result", args: 4, write: true, bytes: 512 },
  creatorAttestation: { sql: "SELECT public.storage_creator_withdrawal_attestation($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::text,$7::text) AS result", args: 5, write: true, bytes: 12288 },
  hostedAccounting: { sql: "SELECT public.storage_hosted_accounting($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 256 },
  hostedPolicy: { sql: "SELECT public.storage_hosted_admit_policy($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  hostedSubmit: { sql: "SELECT public.storage_hosted_submit($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  hostedConfirm: { sql: "SELECT public.storage_hosted_confirm($1::jsonb,$2::text,$3::text,$4::text,$5::text) AS result", args: 3, write: true, bytes: 0 },
  ownerAccounting: { sql: "SELECT public.storage_creator_owner_accounting($1::jsonb,$2::text,$3::text) AS result", args: 1, write: false, bytes: 512 },
  ownerCompletion: { sql: "SELECT public.storage_creator_owner_completion($1::jsonb,$2::text,$3::text,$4::text) AS result", args: 2, write: false, bytes: 32768 },
  ownerAdmit: { sql: "SELECT public.storage_creator_owner_admit($1::jsonb,$2::text,$3::text,$4::jsonb,$5::text) AS result", args: 3, write: true, bytes: 0 },
  ownerComplete: { sql: "SELECT public.storage_creator_owner_complete($1::jsonb,$2::text,$3::text) AS result", args: 1, write: true, bytes: 0 },
});
export class PostgresDomainWriteOutcomeUnknown extends Error {
  constructor() { super("Storage write outcome requires original-bound reconciliation"); }
}
export interface PostgresDomainChannel {
  call(operation: keyof typeof CALLS, args: readonly (string | null)[]): Promise<unknown>;
  readonly closed: boolean;
  close(): Promise<void>;
}
function unavailable(): never { throw new PostgresStorageUnavailable(); }

/** A single bounded pool for composed native domain ports. Not application
 * enrollment/provenance, target discovery, funding, custody or retry authority. */
export function createPostgresDomainChannel(options: PostgresConnectionOptions, expected: StorageIdentity, sourceDigest: string): PostgresDomainChannel {
  const identity = validateStorageIdentity(expected);
  if (identity.authorityMode !== "mainnet-real" || typeof sourceDigest !== "string" || !/^[0-9a-f]{64}$/.test(sourceDigest)) unavailable();
  const expectedWire = canonicalJson(identity), pool = new Pool(postgresPoolConfiguration(options));
  let closed = false, pending = 0, closing: Promise<void> | undefined;
  const inFlight = new Set<Promise<unknown>>();
  pool.on("error", () => {});
  return Object.freeze({
    get closed() { return closed; },
    async call(operation: keyof typeof CALLS, args: readonly (string | null)[]): Promise<unknown> {
      if (closed || typeof operation !== "string" || !Object.hasOwn(CALLS, operation)) unavailable();
      const selected = CALLS[operation];
      if (!Array.isArray(args) || args.length !== selected.args || args.some(value => value !== null && typeof value !== "string")
        || Buffer.byteLength(JSON.stringify(args)) > ('inputBytes' in selected?selected.inputBytes:65536)) unavailable();
      if (pending >= 10) throw new PostgresStorageBusy();
      let submitted = false, request: Promise<unknown> | undefined;
      pending++;
      try {
        submitted = true;
        const statement = { text: selected.sql, rowMode: "array" as const, values: [expectedWire, sourceDigest, ...args] };
        // These read adapters may traverse existing private domain helpers. A
        // real read-only transaction enforces their nonmutation transitively.
        // Only these fixed statements run here; no transaction callback escapes.
        const query = "transaction" in selected && selected.transaction ? (async () => {
          const client = await pool.connect();
          let complete = false;
          try {
            if (closed) unavailable();
            await client.query("BEGIN READ ONLY");
            const result = await client.query(statement);
            await client.query("COMMIT");
            complete = true;
            return result;
          } finally { client.release(!complete); }
        })() : pool.query(statement);
        request = query; inFlight.add(query);
        const result = await query;
        if (closed || result.rows.length !== 1 || result.fields.length !== 1 || result.fields[0].name !== "result"
          || ![114, 3802].includes(result.fields[0].dataTypeID)) unavailable();
        const row = result.rows[0] as unknown[];
        if (!Array.isArray(row) || row.length !== 1) unavailable();
        if (selected.write && selected.bytes === 0) { if (row[0] !== null) unavailable(); return null; }
        if (row[0] === null) return null;
        if (typeof row[0] !== "string" || Buffer.byteLength(row[0]) > selected.bytes) unavailable();
        const value: unknown = JSON.parse(row[0]);
        if (closed || value === null) unavailable();
        return value;
      } catch (error) {
        if (selected.write && submitted) throw new PostgresDomainWriteOutcomeUnknown();
        // Recognized lock contention is a request failure, not evidence that
        // strict Source data or the selected connection has become invalid.
        if (!closed && !selected.write && error instanceof Error && 'code' in error && error.code === '55P03') throw new PostgresStorageBusy();
        return unavailable();
      } finally { pending--; if (request) inFlight.delete(request); }
    },
    close(): Promise<void> {
      closed = true;
      return closing ??= Promise.allSettled([...inFlight]).then(() => pool.end())
        .then(() => {}, () => { throw new PostgresStorageUnavailable(); });
    },
  });
}
