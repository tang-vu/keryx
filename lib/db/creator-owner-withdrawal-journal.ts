import type { DatabaseSync } from "node:sqlite";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "../gateway/withdrawal-request";
import { verifyCreatorOwnerWithdrawalCompletion, type CreatorOwnerWithdrawalCompletion, type CreatorOwnerWithdrawalAccounting } from "../gateway/creator-owner-withdrawal-protocol";
import { sqliteJournalTransaction } from "./sqlite-browser-journal";
import { sqliteSessionFundingAccounting } from "./session-funding-accounting";
import { parseSessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { sqliteHostedAccounting } from "./hosted-treasury-journal";
import { getSqliteWithdrawalRequest } from "./creator-withdrawal-requests";

export const CREATOR_OWNER_WITHDRAWAL_SQL = `
CREATE TABLE creator_owner_withdrawal_completions(request_id TEXT PRIMARY KEY REFERENCES creator_withdrawal_requests(id),
 data TEXT NOT NULL CHECK(length(data)<=16384 AND json_valid(data)));
CREATE TRIGGER creator_owner_complete_writer BEFORE INSERT ON creator_owner_withdrawal_completions
 WHEN NOT EXISTS(SELECT 1 FROM browser_journal_writer) BEGIN SELECT RAISE(ABORT,'owner withdrawal writer required'); END;
CREATE TRIGGER creator_owner_complete_immutable BEFORE UPDATE ON creator_owner_withdrawal_completions
 BEGIN SELECT RAISE(ABORT,'owner withdrawal completion immutable'); END;
CREATE TRIGGER creator_owner_complete_retained BEFORE DELETE ON creator_owner_withdrawal_completions
 BEGIN SELECT RAISE(ABORT,'owner withdrawal completion retained'); END;
CREATE TRIGGER creator_owner_payment_barrier BEFORE INSERT ON browser_authorization_intents
 WHEN EXISTS(SELECT 1 FROM creator_withdrawal_requests r WHERE r.owner=lower(NEW.signer)
 AND NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM creator_owner_withdrawal_completions c WHERE c.request_id=r.id))
 BEGIN SELECT RAISE(ABORT,'owner withdrawal payment admission paused'); END;
CREATE TRIGGER creator_owner_hosted_barrier BEFORE INSERT ON hosted_treasury_authorizations
 WHEN EXISTS(SELECT 1 FROM creator_withdrawal_requests r WHERE r.owner=NEW.signer
 AND NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM creator_owner_withdrawal_completions c WHERE c.request_id=r.id))
 BEGIN SELECT RAISE(ABORT,'owner withdrawal hosted admission paused'); END;
CREATE TRIGGER creator_owner_grant_insert_barrier BEFORE INSERT ON session_grants
 WHEN EXISTS(SELECT 1 FROM creator_withdrawal_requests r WHERE r.owner=lower(NEW.sess_addr)
 AND NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM creator_owner_withdrawal_completions c WHERE c.request_id=r.id))
 BEGIN SELECT RAISE(ABORT,'owner withdrawal payment admission paused'); END;
CREATE TRIGGER creator_owner_grant_update_barrier BEFORE UPDATE ON session_grants
 WHEN NEW.expiry>0 AND EXISTS(SELECT 1 FROM creator_withdrawal_requests r WHERE r.owner=lower(NEW.sess_addr)
 AND NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=r.id)
 AND NOT EXISTS(SELECT 1 FROM creator_owner_withdrawal_completions c WHERE c.request_id=r.id))
 BEGIN SELECT RAISE(ABORT,'owner withdrawal payment admission paused'); END;
`;
const checked = (n: bigint) => { if(n < BigInt(0) || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Owner withdrawal accounting unavailable"); return String(n); };
/** Include every locally retained signer liability. Wallet-owned external spends
 * remain outside this journal and still require fresh vendor availability. */
export function sqliteCreatorOwnerAccounting(db: DatabaseSync, owner: string): CreatorOwnerWithdrawalAccounting {
  const session = sqliteSessionFundingAccounting(db, owner), hosted = sqliteHostedAccounting(db, owner);
  const rows = db.prepare(`SELECT r.data,c.data AS completion FROM creator_withdrawal_requests r
    LEFT JOIN creator_owner_withdrawal_completions c ON c.request_id=r.id WHERE r.owner=?
    AND NOT EXISTS(SELECT 1 FROM session_withdrawal_preparations p WHERE p.request_id=r.id) LIMIT 10001`).all(owner);
  if(rows.length>10000) throw new Error("Owner withdrawal inspection limit exceeded");
  let held=BigInt(0), completed=BigInt(0);
  const sessions=db.prepare(`SELECT p.data,c.request_id AS completed FROM session_withdrawal_preparations p
    LEFT JOIN session_withdrawal_completions c USING(request_id) WHERE p.signer=?
    AND NOT EXISTS(SELECT 1 FROM session_withdrawal_publication_aborts a WHERE a.request_id=p.request_id)
    AND NOT EXISTS(SELECT 1 FROM session_withdrawal_cancellations x WHERE x.request_id=p.request_id) LIMIT 10001`).all(owner);
  if(sessions.length>10000) throw new Error("Owner withdrawal inspection limit exceeded");
  for(const row of sessions) {
    const p=parseSessionWithdrawalPreparation(JSON.parse(String(row.data))), amount=BigInt(p.burnIntent.spec.value)+BigInt(p.burnIntent.maxFee);
    if(row.completed!==null) completed+=amount; else held+=amount;
  }
  for(const row of rows) {
    const r=JSON.parse(String(row.data)) as WithdrawalRequestRecord;
    if(r.network!==ARC_MAINNET_PROFILE.networkId || r.owner!==owner || r.policy.recipient!==owner)
      throw new Error("Original owner withdrawal rail unavailable");
    const amount=BigInt(r.request.burnIntent.spec.value)+BigInt(r.request.burnIntent.maxFee);
    if(row.completion!==null) completed+=amount; else held+=amount;
  }
  return {heldPaymentMicroUsdc:checked(BigInt(session.retainedSpentMicroUsdc)-BigInt(session.confirmedSpentMicroUsdc)+BigInt(hosted.retainedMicroUsdc)-BigInt(hosted.confirmedMicroUsdc)),
    heldWithdrawalMicroUsdc:checked(held), confirmedPaymentMicroUsdc:checked(BigInt(session.confirmedSpentMicroUsdc)+BigInt(hosted.confirmedMicroUsdc)),
    confirmedWithdrawalMicroUsdc:checked(completed)};
}
export async function admitSqliteCreatorOwnerWithdrawal(db:DatabaseSync,value:WithdrawalRequestRecord,baseline:CreatorOwnerWithdrawalAccounting,available:string) {
  const r=await validateWithdrawalRequest(value);
  if(r.network!==ARC_MAINNET_PROFILE.networkId || r.owner!==r.policy.recipient || !/^(0|[1-9][0-9]{0,15})$/.test(available))
    throw new Error("Owner withdrawal authority unavailable");
  sqliteJournalTransaction(db,()=>{
    const prior=db.prepare("SELECT data FROM creator_withdrawal_requests WHERE id=?").get(r.id);
    if(prior) {if(canonicalJson(JSON.parse(String(prior.data)))!==canonicalJson(r)) throw new Error("Original withdrawal conflict"); return;}
    const now=sqliteCreatorOwnerAccounting(db,r.owner);
    if(canonicalJson(now)!==canonicalJson(baseline)) throw new Error("Owner withdrawal accounting changed");
    if(BigInt(now.heldPaymentMicroUsdc)+BigInt(now.heldWithdrawalMicroUsdc)+BigInt(r.request.burnIntent.spec.value)+BigInt(r.request.burnIntent.maxFee)>BigInt(available))
      throw new Error("Owner withdrawal capacity refused");
    db.prepare("INSERT INTO creator_withdrawal_requests(id,owner,data) VALUES(?,?,?)").run(r.id,r.owner,JSON.stringify(r));
    db.prepare("UPDATE session_grants SET expiry=0 WHERE lower(sess_addr)=?").run(r.owner);
  });
  return (await getSqliteWithdrawalRequest(db,r.id,r.owner))!;
}
export async function readSqliteCreatorOwnerCompletion(db:DatabaseSync,id:string,owner:string) {
  const r=await getSqliteWithdrawalRequest(db,id,owner); if(!r) return null;
  const row=db.prepare("SELECT data FROM creator_owner_withdrawal_completions WHERE request_id=?").get(id);
  if(!row) return null;
  const c=await verifyCreatorOwnerWithdrawalCompletion(JSON.parse(String(row.data)));
  if(canonicalJson(c.record)!==canonicalJson(r)) throw new Error("Original owner completion conflict"); return c;
}
export async function completeSqliteCreatorOwnerWithdrawal(db:DatabaseSync,value:CreatorOwnerWithdrawalCompletion) {
  const c=await verifyCreatorOwnerWithdrawalCompletion(value), original=await getSqliteWithdrawalRequest(db,c.requestId,c.ownerAddr);
  if(!original || canonicalJson(original)!==canonicalJson(c.record)) throw new Error("Original owner withdrawal unavailable");
  sqliteJournalTransaction(db,()=>{
    const a=db.prepare("SELECT data FROM creator_withdrawal_attestations WHERE id=?").get(c.requestId);
    if(!a || canonicalJson(JSON.parse(String(a.data)))!==canonicalJson(c.attestation)) throw new Error("Original owner attestation unavailable");
    db.prepare("INSERT INTO creator_owner_withdrawal_completions(request_id,data) VALUES(?,?) ON CONFLICT DO NOTHING").run(c.requestId,canonicalJson(c));
    if(db.prepare("SELECT data FROM creator_owner_withdrawal_completions WHERE request_id=?").get(c.requestId)?.data!==canonicalJson(c))
      throw new Error("Original owner completion conflict");
  });
  return (await readSqliteCreatorOwnerCompletion(db,c.requestId,c.ownerAddr))!;
}
