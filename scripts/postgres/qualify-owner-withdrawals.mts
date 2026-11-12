import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { encodeFunctionData } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { installMainnetApplicationSchema } from "../../lib/db/mainnet-application-schema";
import { sqliteJournalTransaction } from "../../lib/db/sqlite-browser-journal";
import { sqliteCreatorOwnerAccounting,admitSqliteCreatorOwnerWithdrawal,completeSqliteCreatorOwnerWithdrawal,readSqliteCreatorOwnerCompletion } from "../../lib/db/creator-owner-withdrawal-journal";
import { claimSqliteWithdrawalTransfer } from "../../lib/db/creator-withdrawal-requests";
import { saveSqliteWithdrawalAttestation } from "../../lib/db/creator-withdrawal-attestations";
import { nativeCreatorWithdrawalFixture,nativeCreatorAttestationFixture } from "./withdrawal-fixtures";
import { matchWithdrawalAttestation } from "../../lib/gateway/withdrawal-attestation";
import { matchWithdrawalMintTransaction } from "../../lib/gateway/withdrawal-mint-transaction";
import { WITHDRAWAL_MINTER_ABI } from "../../lib/gateway/withdrawal-mint-observation";
import { verifyCreatorOwnerWithdrawalCompletion } from "../../lib/gateway/creator-owner-withdrawal-protocol";
import type { PostgresOwnerWithdrawalTransport } from "../../lib/db/postgres/owner-withdrawal-transport";

/** Local immutable originals, unfunded signatures and a synthetic recorded
 * observation. No actual custody, vendor transfer, RPC or mint is exercised. */
export async function qualifyOwnerWithdrawals(input:{transport:PostgresOwnerWithdrawalTransport;ownerSql:(s:string)=>string}){
  const db=new DatabaseSync(':memory:'),t=input.transport,account=privateKeyToAccount(`0x${'11'.repeat(32)}`),owner=account.address.toLowerCase(),epoch=randomUUID();let vectors=0;
  const q=(s:string)=>`'${s.replaceAll("'","''")}'`;
  const accounting=async()=>{const source=sqliteCreatorOwnerAccounting(db,owner);assert.deepEqual(await t.creatorOwnerWithdrawalAccounting(owner),source);vectors++;return source;};
  try{
    db.exec('BEGIN');installMainnetApplicationSchema(db);db.exec('COMMIT;UPDATE browser_journal_control SET active=1 WHERE id=1');
    sqliteJournalTransaction(db,()=>{
      db.prepare('INSERT INTO browser_signer_capacity VALUES(?,100000)').run(owner);
      db.prepare("INSERT INTO browser_retained_grants VALUES(?,'synthetic-owner-alias',?,0)").run(epoch,owner);
      db.prepare("INSERT INTO session_grants VALUES('synthetic-owner-alias',?,?,1,0.1,?,'synthetic',?)").run(owner,`0x${'bb'.repeat(20)}`,Date.now()+60000,epoch);
    });
    input.ownerSql(`UPDATE keryx_storage.control SET mode='held';INSERT INTO public.browser_signer_capacity VALUES(${q(owner)},100000);
      INSERT INTO public.browser_retained_grants VALUES(${q(epoch)},'synthetic-owner-alias',${q(owner)},0);
      INSERT INTO public.session_grants VALUES('synthetic-owner-alias',${q(owner)},${q(`0x${'bb'.repeat(20)}`)},1,0.1,${Date.now()+60000},'synthetic',${q(epoch)});
      UPDATE keryx_storage.control SET mode='active';`);
    const r=await nativeCreatorWithdrawalFixture(account),baseline=await accounting();
    await assert.rejects(t.admitCreatorOwnerWithdrawal(r,baseline,'100000'));await assert.rejects(admitSqliteCreatorOwnerWithdrawal(db,r,baseline,'100000'));
    assert.deepEqual(await t.admitCreatorOwnerWithdrawal(r,baseline,'1000000'),await admitSqliteCreatorOwnerWithdrawal(db,r,baseline,'1000000'));vectors++;
    await accounting();assert.equal(input.ownerSql("SELECT expiry FROM public.session_grants WHERE session_id='synthetic-owner-alias';"),'0');
    assert.deepEqual(await t.admitCreatorOwnerWithdrawal(r,baseline,'1000000'),await admitSqliteCreatorOwnerWithdrawal(db,r,baseline,'1000000'));vectors++;
    assert.equal(await t.getCreatorOwnerWithdrawalCompletion(r.id,owner),null);
    const next=await nativeCreatorWithdrawalFixture(account);await assert.rejects(t.admitCreatorOwnerWithdrawal(next,baseline,'1000000'));await assert.rejects(admitSqliteCreatorOwnerWithdrawal(db,next,baseline,'1000000'));
    const fresh=await accounting();await assert.rejects(t.admitCreatorOwnerWithdrawal(next,fresh,'200000'));await assert.rejects(admitSqliteCreatorOwnerWithdrawal(db,next,fresh,'200000'));
    const nativeClaim=await t.claimCreatorWithdrawalTransfer(r.id,owner),sourceClaim=await claimSqliteWithdrawalTransfer(db,r.id,owner);assert(nativeClaim&&sourceClaim);
    const response=await nativeCreatorAttestationFixture(r),attestation=await matchWithdrawalAttestation(r,response);
    const terms={relayer:owner as `0x${string}`,nonce:7,gas:'50000',maxFeePerGas:'20',maxPriorityFeePerGas:'1',gasBudgetWei:'1000000'};
    const raw=await account.signTransaction({type:'eip1559',chainId:profile.chainId,to:profile.gatewayMinter,nonce:terms.nonce,gas:BigInt(terms.gas),
      maxFeePerGas:BigInt(terms.maxFeePerGas),maxPriorityFeePerGas:BigInt(terms.maxPriorityFeePerGas),value:BigInt(0),
      data:encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:'gatewayMint',args:[attestation.attestation,attestation.signature]})});
    const matched=await matchWithdrawalMintTransaction(r,attestation,raw,terms);
    const completion=await verifyCreatorOwnerWithdrawalCompletion({format:'keryx-creator-owner-withdrawal-completion-v1',network:profile.networkId,requestId:r.id,ownerAddr:owner,
      record:r,attestation,serializedTransaction:raw,terms,observation:{status:'mint-finalized-observed',authority:'arc-mainnet-rpc-finality',requestId:r.id,
        transactionHash:matched.transactionHash,transferSpecHash:matched.transferSpecHash,chainId:profile.chainId,blockNumber:'1101',blockHash:`0x${'66'.repeat(32)}`,
        transactionIndex:0,logIndex:0,recipient:owner,amountMicros:r.request.burnIntent.spec.value,gasUsed:'40000',effectiveGasPriceWei:'10',gasCostWei:'400000',
        chainFinalityVerified:true,finalityBasis:'operator-selected-rpc',finalizedBlockNumber:'1102',finalizedBlockHash:`0x${'77'.repeat(32)}`,observedAt:new Date().toISOString()}});
    await assert.rejects(t.completeCreatorOwnerWithdrawal(completion));await assert.rejects(completeSqliteCreatorOwnerWithdrawal(db,completion));
    await t.saveCreatorWithdrawalAttestation(r.id,owner,nativeClaim.claimId,response);await saveSqliteWithdrawalAttestation(db,r.id,owner,sourceClaim.claimId,response);
    assert.deepEqual(await t.completeCreatorOwnerWithdrawal(completion),await completeSqliteCreatorOwnerWithdrawal(db,completion));vectors++;
    assert.deepEqual(await t.getCreatorOwnerWithdrawalCompletion(r.id,owner),await readSqliteCreatorOwnerCompletion(db,r.id,owner));vectors++;
    await accounting();await t.completeCreatorOwnerWithdrawal(completion);await assert.rejects(t.completeCreatorOwnerWithdrawal({...completion,ownerAddr:`0x${'99'.repeat(20)}`}));
    assert.equal(input.ownerSql(`SELECT spent_micro FROM public.browser_signer_capacity WHERE signer=${q(owner)};`),'100000');
    assert.equal(input.ownerSql('SELECT count(*) FROM keryx_storage.writer;'),'0');
    return{vectors,allRetainedLiabilities:true,staleAccountingAndInsufficientCapacityRefused:true,grantPausedWithoutCapacityReset:true,
      originalMatchedAttestationRequired:true,idempotentImmutableCompletion:true,unfundedSyntheticRecordedObservation:true,paidOperations:0,vendorRequests:0};
  }finally{db.close();}
}
