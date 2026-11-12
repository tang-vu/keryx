/** Actual native session withdrawal protocol versus the existing SQLite domain.
 * Only unfunded fixture signatures/recorded observations; no provider/chain IO. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "../../lib/canonical-json";
import { installMainnetApplicationSchema } from "../../lib/db/mainnet-application-schema";
import { sqliteJournalTransaction } from "../../lib/db/sqlite-browser-journal";
import { sqliteSessionWithdrawalAccounting, reserveSqliteSessionWithdrawal, readSqliteSessionWithdrawal,
  pendingSqliteSessionWithdrawal, readSqliteSessionWithdrawalPhase, exposeSqliteSessionWithdrawal, cancelSqliteSessionWithdrawal,
  readSqliteSessionWithdrawalCompletion, completeSqliteSessionWithdrawal } from "../../lib/db/session-withdrawal-journal";
import { abortSqliteSessionWithdrawal, readSqliteSessionWithdrawalAbort } from "../../lib/db/session-withdrawal-abort";
import { createSessionWithdrawalAbort, sessionWithdrawalAbortMessage } from "../../lib/gateway/session-withdrawal-abort";
import { sessionWithdrawalFixture } from "../../lib/gateway/session-withdrawal-test-fixture";
import { headlessCashoutCompletion } from "../helpers/headless-cashout-test-fixture";
import { withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import { verifySessionWithdrawalCompletion } from "../../lib/gateway/session-withdrawal-completion";
import type { SessionWithdrawalPreparation } from "../../lib/gateway/session-withdrawal-protocol";
import { createPostgresWithdrawalTransport, type PostgresWithdrawalTransport } from "../../lib/db/postgres/withdrawal-transport";
import { PostgresDomainWriteOutcomeUnknown } from "../../lib/db/postgres/domain-channel";
import type { PostgresConnectionOptions } from "../../lib/db/postgres/connection";
import type { StorageIdentity } from "../../lib/db/storage-identity";
import { startCommitAckLossProxy } from "./commit-ack-loss.mts";
import { reserveSqliteWithdrawalRequest,claimSqliteWithdrawalTransfer } from "../../lib/db/creator-withdrawal-requests";
import { saveSqliteWithdrawalAttestation } from "../../lib/db/creator-withdrawal-attestations";
import type { PostgresCreatorWithdrawalTransport } from "../../lib/db/postgres/creator-withdrawal-transport";

export async function qualifySessionWithdrawals(input: { transport: PostgresWithdrawalTransport; options: PostgresConnectionOptions;
  identity: StorageIdentity; digest: string; ownerSql: (statement: string) => string; creatorTransport?: PostgresCreatorWithdrawalTransport }) {
  const db=new DatabaseSync(":memory:"), t=input.transport, signer=privateKeyToAccount(`0x${"22".repeat(32)}`);
  const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
  let comparisons=0;
  const accounting = async (p:SessionWithdrawalPreparation) => {
    assert.deepEqual(await t.sessionWithdrawalAccounting(p.sessAddr),sqliteSessionWithdrawalAccounting(db,p.sessAddr)); comparisons++;
    assert.equal(input.ownerSql(`SELECT count(*) FROM keryx_storage.writer;`),"0");
    assert.equal(input.ownerSql(`SELECT expiry FROM public.session_grants WHERE session_id=${q(p.ownerAddr)};`),"0");
    assert.equal(input.ownerSql(`SELECT spent_micro FROM public.browser_signer_capacity WHERE signer=${q(p.sessAddr)};`),"100000");
  };
  const reserve=async(p:SessionWithdrawalPreparation)=>{
    assert.deepEqual(await t.reserveSessionWithdrawal(p),await reserveSqliteSessionWithdrawal(db,p)); comparisons++;
    await accounting(p);
  };
  const abort=async(p:SessionWithdrawalPreparation)=>{
    const proof=await createSessionWithdrawalAbort(p,await signer.signMessage({message:sessionWithdrawalAbortMessage(p)}));
    assert.deepEqual(await t.abortSessionWithdrawal(p.requestId,p.ownerAddr,proof),await abortSqliteSessionWithdrawal(db,p.requestId,p.ownerAddr,proof)); comparisons++;
    assert.deepEqual(await t.getSessionWithdrawalAbort(p.requestId,p.ownerAddr),await readSqliteSessionWithdrawalAbort(db,p.requestId,p.ownerAddr)); comparisons++;
  };
  const phase=async(p:SessionWithdrawalPreparation)=>{
    assert.equal(await t.getSessionWithdrawalSigningPhase(p.requestId,p.ownerAddr),await readSqliteSessionWithdrawalPhase(db,p.requestId,p.ownerAddr)); comparisons++;
  };
  try {
    db.exec("BEGIN");installMainnetApplicationSchema(db);db.exec("COMMIT;UPDATE browser_journal_control SET active=1 WHERE id=1");
    const p=await sessionWithdrawalFixture(),c=p.authorization.consent;
    sqliteJournalTransaction(db,()=>{
      db.prepare("INSERT INTO session_grant_consents VALUES(?,?,?,?,?,?,?,?,?)").run(c.grantEpoch,c.ownerAddr,c.sessAddr,canonicalJson(c),1,2,2,p.authorization.ownerSignature,p.authorization.sessionSignature);
      db.prepare("INSERT INTO browser_signer_capacity VALUES(?,100000)").run(p.sessAddr);
      db.prepare("INSERT INTO browser_retained_grants VALUES(?,?,?,0)").run(c.grantEpoch,c.ownerAddr,c.sessAddr);
      db.prepare("INSERT INTO session_grants VALUES(?,?,?,1,0.1,?, 'synthetic-original',?)").run(c.ownerAddr,c.sessAddr,c.ownerAddr,Date.now()+60000,c.grantEpoch);
    });
    input.ownerSql(`UPDATE keryx_storage.control SET mode='held';
      INSERT INTO public.session_grant_consents VALUES(${q(c.grantEpoch)},${q(c.ownerAddr)},${q(c.sessAddr)},${q(canonicalJson(c))},1,2,2,${q(p.authorization.ownerSignature)},${q(p.authorization.sessionSignature)});
      INSERT INTO public.browser_signer_capacity VALUES(${q(p.sessAddr)},100000);
      INSERT INTO public.browser_retained_grants VALUES(${q(c.grantEpoch)},${q(c.ownerAddr)},${q(c.sessAddr)},0);
      INSERT INTO public.session_grants VALUES(${q(c.ownerAddr)},${q(c.sessAddr)},${q(c.ownerAddr)},1,0.1,${Date.now()+60000},'synthetic-original',${q(c.grantEpoch)});
      UPDATE keryx_storage.control SET mode='active';`);
    await assert.rejects(t.reserveSessionWithdrawal({...p,ownerAddr:`0x${"99".repeat(20)}`}));
    await reserve(p);await reserve(p);
    assert.deepEqual(await t.getSessionWithdrawal(p.requestId,p.ownerAddr),await readSqliteSessionWithdrawal(db,p.requestId,p.ownerAddr));comparisons++;
    assert.deepEqual(await t.pendingSessionWithdrawal(p.ownerAddr,p.sessAddr),await pendingSqliteSessionWithdrawal(db,p.ownerAddr,p.sessAddr));comparisons++;
    assert.equal(await t.getSessionWithdrawal(p.requestId,`0x${"99".repeat(20)}`),null);
    const blocked=await sessionWithdrawalFixture();await assert.rejects(t.reserveSessionWithdrawal(blocked));await assert.rejects(reserveSqliteSessionWithdrawal(db,blocked));
    assert.deepEqual(await t.cancelSessionWithdrawal(p.requestId,p.ownerAddr),await cancelSqliteSessionWithdrawal(db,p.requestId,p.ownerAddr));comparisons++;
    assert.equal(await t.pendingSessionWithdrawal(p.ownerAddr,p.sessAddr),null);await phase(p);await accounting(p);
    await assert.rejects(t.reserveSessionWithdrawal(p));await assert.rejects(reserveSqliteSessionWithdrawal(db,p));
    await assert.rejects(t.authorizeSessionWithdrawal(p.requestId,p.ownerAddr));

    const exposed=await sessionWithdrawalFixture();await reserve(exposed);
    assert.deepEqual(await t.authorizeSessionWithdrawal(exposed.requestId,exposed.ownerAddr),await exposeSqliteSessionWithdrawal(db,exposed.requestId,exposed.ownerAddr));comparisons++;
    await phase(exposed);await assert.rejects(t.cancelSessionWithdrawal(exposed.requestId,exposed.ownerAddr));await assert.rejects(cancelSqliteSessionWithdrawal(db,exposed.requestId,exposed.ownerAddr));
    await abort(exposed);await abort(exposed);await phase(exposed);await accounting(exposed);
    await assert.rejects(t.authorizeSessionWithdrawal(exposed.requestId,exposed.ownerAddr));await assert.rejects(t.reserveSessionWithdrawal(exposed));

    // Both callers read the same original before racing the native transition.
    const raced=await sessionWithdrawalFixture();await reserve(raced);
    const race=await Promise.allSettled([t.authorizeSessionWithdrawal(raced.requestId,raced.ownerAddr),t.cancelSessionWithdrawal(raced.requestId,raced.ownerAddr)]);
    assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
    if(race[0].status==='fulfilled') await exposeSqliteSessionWithdrawal(db,raced.requestId,raced.ownerAddr);
    else await cancelSqliteSessionWithdrawal(db,raced.requestId,raced.ownerAddr);
    await phase(raced);if(race[0].status==='fulfilled')await abort(raced);await accounting(raced);

    const uncertain=await sessionWithdrawalFixture();await reserve(uncertain);
    assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port);
    const broken=createPostgresWithdrawalTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
    try {
      proxy.arm(1);await assert.rejects(broken.authorizeSessionWithdrawal(uncertain.requestId,uncertain.ownerAddr),PostgresDomainWriteOutcomeUnknown);
      assert.deepEqual(proxy.observation(),{dropped:true,commands:2});
      await exposeSqliteSessionWithdrawal(db,uncertain.requestId,uncertain.ownerAddr);await phase(uncertain);
      assert.equal(input.ownerSql(`SELECT count(*) FROM public.session_withdrawal_exposures WHERE request_id=${q(uncertain.requestId)};`),'1');
      await assert.rejects(t.cancelSessionWithdrawal(uncertain.requestId,uncertain.ownerAddr));
    }finally{await broken.close();await proxy.close();}
    await abort(uncertain);await accounting(uncertain);

    const completed=await sessionWithdrawalFixture();await reserve(completed);
    await t.authorizeSessionWithdrawal(completed.requestId,completed.ownerAddr);await exposeSqliteSessionWithdrawal(db,completed.requestId,completed.ownerAddr);
    const fixture=await headlessCashoutCompletion(completed,await signer.signTypedData(withdrawTypedData(completed.burnIntent)));
    const completion=await verifySessionWithdrawalCompletion(fixture.completion,completed);
    await assert.rejects(t.completeSessionWithdrawal(completed.requestId,completed.ownerAddr,completion));
    await reserveSqliteWithdrawalRequest(db,completion.record);const sourceClaim=await claimSqliteWithdrawalTransfer(db,completed.requestId,completed.sessAddr);
    assert(sourceClaim);await saveSqliteWithdrawalAttestation(db,completed.requestId,completed.sessAddr,sourceClaim.claimId,completion.attestation);
    if(input.creatorTransport){
      await input.creatorTransport.reserveCreatorWithdrawal(completion.record);
      const claim=await input.creatorTransport.claimCreatorWithdrawalTransfer(completed.requestId,completed.sessAddr);assert(claim);
      await input.creatorTransport.saveCreatorWithdrawalAttestation(completed.requestId,completed.sessAddr,claim.claimId,completion.attestation);
    }else{const claimId=randomUUID();input.ownerSql(`UPDATE keryx_storage.control SET mode='held';
      INSERT INTO public.creator_withdrawal_requests(id,owner,data) VALUES(${q(completed.requestId)},${q(completed.sessAddr)},${q(JSON.stringify(completion.record))});
      INSERT INTO public.creator_withdrawal_transfer_attempts(id,claim_id) VALUES(${q(completed.requestId)},${q(claimId)});
      INSERT INTO public.creator_withdrawal_attestations(id,claim_id,transfer_id,data) VALUES(${q(completed.requestId)},${q(claimId)},${q(completion.attestation.transferId)},${q(JSON.stringify(completion.attestation))});
      UPDATE keryx_storage.control SET mode='active';`);}
    assert.deepEqual(await t.completeSessionWithdrawal(completed.requestId,completed.ownerAddr,completion),await completeSqliteSessionWithdrawal(db,completed.requestId,completed.ownerAddr,completion));comparisons++;
    assert.deepEqual(await t.getSessionWithdrawalCompletion(completed.requestId,completed.ownerAddr),await readSqliteSessionWithdrawalCompletion(db,completed.requestId,completed.ownerAddr));comparisons++;
    await phase(completed);await accounting(completed);
    await assert.rejects(t.cancelSessionWithdrawal(completed.requestId,completed.ownerAddr));
    return {comparisons,preparedCancelAndExposedAbort:true,concurrentExposeCancelExactlyOne:true,actualExposureCommitAckLost:true,
      noAutomaticWriteRetry:true,retainedCapacityNeverReset:true,originalCompletionRequired:true,unfundedSyntheticRecordedObservation:true,
      paidOperations:0,vendorRequests:0,nativeCreatorTransferProtocols:!!input.creatorTransport,
      limitations:input.creatorTransport?'Synthetic domain protocol qualification only; no installed mainnet backend or production cutover.':'Session withdrawal protocol qualification; creator transfer/attestation rows for completion are imported fixture dependencies.'};
  }finally{db.close();}
}
