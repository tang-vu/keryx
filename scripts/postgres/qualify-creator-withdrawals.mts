import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { concatHex, encodePacked, keccak256 } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { canonicalJson } from "../../lib/canonical-json";
import { prepareWithdrawIntentForProfile } from "../../lib/gateway/withdraw-intent-core";
import { withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import { createWithdrawalRequest, type WithdrawalRequestRecord } from "../../lib/gateway/withdrawal-request";
import { installMainnetApplicationSchema } from "../../lib/db/mainnet-application-schema";
import { sqliteJournalTransaction } from "../../lib/db/sqlite-browser-journal";
import { reserveSqliteWithdrawalRequest, getSqliteWithdrawalRequest, claimSqliteWithdrawalTransfer, getSqliteWithdrawalTransferClaim } from "../../lib/db/creator-withdrawal-requests";
import { getSqliteWithdrawalAttestation, saveSqliteWithdrawalAttestation } from "../../lib/db/creator-withdrawal-attestations";
import { listSqliteWithdrawalHistory } from "../../lib/db/creator-withdrawal-history";
import type { WithdrawalHistoryCursor } from "../../lib/gateway/withdrawal-history-types";
import { createPostgresCreatorWithdrawalTransport, type PostgresCreatorWithdrawalTransport } from "../../lib/db/postgres/creator-withdrawal-transport";
import { PostgresDomainWriteOutcomeUnknown } from "../../lib/db/postgres/domain-channel";
import type { PostgresConnectionOptions } from "../../lib/db/postgres/connection";
import type { StorageIdentity } from "../../lib/db/storage-identity";
import { startCommitAckLossProxy } from "./commit-ack-loss.mts";

/** Unfunded deterministic fixture wallets. This never reads a custody file or
 * makes a vendor/RPC call; a matched attestation is not a finality assertion. */
const account=privateKeyToAccount(`0x${"33".repeat(32)}`),attester=privateKeyToAccount(`0x${"44".repeat(32)}`);
async function fixture(){
  const burnIntent={...prepareWithdrawIntentForProfile(profile,account.address,"50000",account.address,"100"),maxBlockHeight:"1100"};
  return createWithdrawalRequest({burnIntent,signature:await account.signTypedData(withdrawTypedData(burnIntent))},
    {owner:account.address,recipient:account.address,domain:profile.cctpDomain,gatewayWallet:profile.gatewayWallet,gatewayMinter:profile.gatewayMinter,
      asset:profile.usdcAddress,maxValueMicros:"50000",maxFeeMicros:"100"},profile);
}
async function response(record:WithdrawalRequestRecord){
  const s=record.request.burnIntent.spec;
  const encoded=concatHex([encodePacked(["bytes4","uint32","uint32","uint32"],["0xca85def7",s.version,s.sourceDomain,s.destinationDomain]),
    s.sourceContract,s.destinationContract,s.sourceToken,s.destinationToken,s.sourceDepositor,s.destinationRecipient,s.sourceSigner,s.destinationCaller,
    encodePacked(["uint256","bytes32","uint32"],[BigInt(s.value),s.salt,0])]);
  const attestation=concatHex([encodePacked(["bytes4","uint256","uint32"],["0xff6fb334",BigInt(1200),340]),encoded]);
  return{transferId:randomUUID(),attestation,expirationBlock:"1200",signature:await attester.signMessage({message:{raw:keccak256(attestation)}})};
}
export async function qualifyCreatorWithdrawals(input:{transport:PostgresCreatorWithdrawalTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(statement:string)=>string}){
  const db=new DatabaseSync(":memory:"),t=input.transport,q=(s:string)=>`'${s.replaceAll("'","''")}'`;let comparisons=0;
  try{
    db.exec('BEGIN');installMainnetApplicationSchema(db);db.exec('COMMIT');
    const r=await fixture();assert.deepEqual(await t.reserveCreatorWithdrawal(r),await reserveSqliteWithdrawalRequest(db,r));comparisons++;
    assert.deepEqual(await t.reserveCreatorWithdrawal(r),await reserveSqliteWithdrawalRequest(db,r));comparisons++;
    assert.deepEqual(await t.getCreatorWithdrawal(r.id,r.owner),await getSqliteWithdrawalRequest(db,r.id,r.owner));comparisons++;
    assert.equal(await t.getCreatorWithdrawal(r.id,`0x${"99".repeat(20)}`),null);
    const blockedEpoch=randomUUID();
    assert.throws(()=>input.ownerSql(`BEGIN;UPDATE keryx_storage.control SET mode='held';
      INSERT INTO public.browser_retained_grants VALUES(${q(blockedEpoch)},'synthetic-blocked-grant',${q(r.owner)},0);
      INSERT INTO public.session_grants VALUES('synthetic-blocked-grant',${q(r.owner)},${q(r.owner)},1,0,0,'synthetic',${q(blockedEpoch)});ROLLBACK;`),/original withdrawal admission barrier/);
    assert.throws(()=>db.prepare("INSERT INTO session_grants VALUES('synthetic-blocked-grant',?,?,1,0,0,'synthetic',?)").run(r.owner,r.owner,blockedEpoch),/owner withdrawal payment admission paused/);
    const changed=structuredClone(r.request);changed.burnIntent.maxBlockHeight="1150";changed.signature=await account.signTypedData(withdrawTypedData(changed.burnIntent));
    const duplicateSpec=await createWithdrawalRequest(changed,r.policy,profile);
    await assert.rejects(t.reserveCreatorWithdrawal(duplicateSpec));await assert.rejects(reserveSqliteWithdrawalRequest(db,duplicateSpec));
    const races=await Promise.all([t.claimCreatorWithdrawalTransfer(r.id,r.owner),t.claimCreatorWithdrawalTransfer(r.id,r.owner)]);
    assert.equal(races.filter(Boolean).length,1);const nativeClaim=races.find(Boolean)!;
    const sourceClaims=await Promise.all([claimSqliteWithdrawalTransfer(db,r.id,r.owner),claimSqliteWithdrawalTransfer(db,r.id,r.owner)]);
    assert.equal(sourceClaims.filter(Boolean).length,1);const sourceClaim=sourceClaims.find(Boolean)!;
    assert.deepEqual(await t.getCreatorWithdrawalTransferClaim(r.id,r.owner),nativeClaim);assert.deepEqual(await getSqliteWithdrawalTransferClaim(db,r.id,r.owner),sourceClaim);comparisons++;
    const proof=await response(r),saved=await t.saveCreatorWithdrawalAttestation(r.id,r.owner,nativeClaim.claimId,proof),source=await saveSqliteWithdrawalAttestation(db,r.id,r.owner,sourceClaim.claimId,proof);
    assert.equal(canonicalJson({...saved,savedAt:undefined}),canonicalJson({...source,savedAt:undefined}));comparisons++;
    assert.deepEqual(await t.saveCreatorWithdrawalAttestation(r.id,r.owner,nativeClaim.claimId,proof),saved);comparisons++;
    assert.deepEqual(await t.getCreatorWithdrawalAttestation(r.id,r.owner),saved);assert.deepEqual(await getSqliteWithdrawalAttestation(db,r.id,r.owner),source);comparisons++;
    await assert.rejects(t.saveCreatorWithdrawalAttestation(r.id,r.owner,nativeClaim.claimId,{...proof,expirationBlock:"1199"}));
    await assert.rejects(t.saveCreatorWithdrawalAttestation(r.id,r.owner,randomUUID(),proof));
    await assert.rejects(t.reserveCreatorWithdrawal({...r,owner:`0x${"99".repeat(20)}`}));

    const uncertain=await fixture();await t.reserveCreatorWithdrawal(uncertain);await reserveSqliteWithdrawalRequest(db,uncertain);
    assert.equal(input.options.endpoint.kind,'loopback');const proxy=await startCommitAckLossProxy(input.options.endpoint.port);
    const broken=createPostgresCreatorWithdrawalTransport({...input.options,endpoint:{kind:'loopback',port:proxy.port}},input.identity,input.digest);
    try{
      proxy.arm(1);await assert.rejects(broken.claimCreatorWithdrawalTransfer(uncertain.id,uncertain.owner),PostgresDomainWriteOutcomeUnknown);
      assert.deepEqual(proxy.observation(),{dropped:true,commands:2});assert(await t.getCreatorWithdrawalTransferClaim(uncertain.id,uncertain.owner));
      assert.equal(await t.claimCreatorWithdrawalTransfer(uncertain.id,uncertain.owner),null);assert(await claimSqliteWithdrawalTransfer(db,uncertain.id,uncertain.owner));comparisons++;
    }finally{await broken.close();await proxy.close();}

    // Equal-time tie breakers are actual retained rows, independently installed
    // in both fixtures. No update of an immutable timestamp is used to arrange it.
    const stamp='2026-11-12T04:00:00.000Z';let sql="UPDATE keryx_storage.control SET mode='held';";
    for(let i=0;i<8;i++){const row=await fixture(),data=JSON.stringify(row);
      sqliteJournalTransaction(db,()=>db.prepare('INSERT INTO creator_withdrawal_requests(id,owner,data,created_at) VALUES(?,?,?,?)').run(row.id,row.owner,data,stamp));
      sql+=`INSERT INTO public.creator_withdrawal_requests(id,owner,data,created_at) VALUES(${q(row.id)},${q(row.owner)},${q(data)},${q(stamp)});`;
    }input.ownerSql(sql+"UPDATE keryx_storage.control SET mode='active';");
    let nativeCursor:WithdrawalHistoryCursor|undefined,sourceCursor:WithdrawalHistoryCursor|undefined;const seen=new Set<string>();
    for(let page=0;page<6;page++){
      const a=await t.listCreatorWithdrawalHistory(r.owner,nativeCursor,2),b=await listSqliteWithdrawalHistory(db,r.owner,sourceCursor,2);
      assert.deepEqual(a.requests.map(x=>({...x,createdAt:undefined})),b.requests.map(x=>({...x,createdAt:undefined})));comparisons++;
      for(const row of a.requests){assert(!seen.has(row.id));seen.add(row.id);}
      assert.equal(a.nextCursor?.id??null,b.nextCursor?.id??null);nativeCursor=a.nextCursor??undefined;sourceCursor=b.nextCursor??undefined;if(!nativeCursor)break;
    }assert.equal(seen.size,10);
    assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
    return{comparisons,singleTransferClaimAcrossConnections:true,actualLostClaimCommitAck:true,noAutomaticClaimRetry:true,
      sameTransferSpecCannotReadmit:true,pendingOwnerBlocksEvenRevokedGrantInsert:true,requestMatchedAttestationOnly:true,equalTimeCursorPaging:true,paidOperations:0,vendorRequests:0};
  }finally{db.close();}
}
