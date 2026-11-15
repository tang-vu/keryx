import assert from 'node:assert/strict';
import type {Client} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {createPostgresDomainChannel} from '../../lib/db/postgres/domain-channel';
import {PostgresStorageUnavailable,type PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import type {StorageIdentity} from '../../lib/db/storage-identity';
import type {capturePaymentEvent} from '../../lib/db/postgres/payment-events-packet';
import {LEGACY_PAYMENT_CONSUMED_FIELDS} from './payment-browser-source.mts';
const fundingSql='SELECT public.storage_session_funding_accounting($1::jsonb,$2::text,$3::text,$4::text) AS result';
const rawRefusal='native payment raw observation unavailable to legacy observer';
/** A real queued adapter-reader probe, using a fixed synthetic/captured packet only.
 * It issues no provider action and creates no Source or installed-facade proof. */
export async function qualifyPaymentObserverWait(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;holder:Client},packet:ReturnType<typeof capturePaymentEvent>){
 // Presentation-only flags are now safely ignored by this exact consumer. The
 // negative must contain a real unsupported consumed cell, never a forged mask.
 assert(LEGACY_PAYMENT_CONSUMED_FIELDS.session_funding_accounting.includes('tx_hash'));
 assert(packet.unprojectedFields.includes('tx_hash'),'Queued refusal requires an unsupported consumed tx_hash');
 assert.equal(packet.projection.tx_hash,null);
 assert(typeof packet.row.tx_hash==='string'&&packet.row.tx_hash.includes('\0'),'Retain the actual Source NUL receipt');
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest);
 type Outcome={error:unknown}|{value:unknown};
 let open=false,settled=false,queued:Promise<Outcome>|undefined;
 try{
  const prior=await input.holder.query('SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=$1',[input.options.role]);
  const priorPids=new Set(prior.rows.map(row=>Number(row.pid)));
  await channel.call('funding',[String(packet.row.payer),null]);
  const own=await input.holder.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND application_name='keryx-postgres-guarded' AND query=$2",[input.options.role,fundingSql]);
  const readerPids=own.rows.map(row=>Number(row.pid)).filter(pid=>!priorPids.has(pid));
  assert.equal(readerPids.length,1,'Warmup must identify this actual adapter backend');
  const readerPid=readerPids[0];assert(Number.isSafeInteger(readerPid)&&readerPid>0);
  await input.holder.query('BEGIN');open=true;
  await input.holder.query({text:"SELECT public.storage_payment_events($1::jsonb,$2::text,'record',$3::text)",values:[canonicalJson(input.identity),input.digest,JSON.stringify({rowWire:packet.rowWire,sha256:packet.sha256,projection:packet.projection,unprojectedFields:packet.unprojectedFields})]});
  // Contain early rejection while observing the lock. A completed/timeout read
  // before the witness or writer commit is never accepted as raw-refusal proof.
  queued=channel.call('funding',[String(packet.row.payer),null]).then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
  let blocked=false;const started=Date.now(),deadline=started+4000;
  while(Date.now()<deadline){
   assert(!settled,'Adapter reader completed before its live data-lock witness');
   // pg_locks is live, independent of cached pg_stat_activity snapshots within
   // the held writer transaction. Match this warmed backend and exact bigint key.
   const waiting=await input.holder.query(`SELECT count(*)::text n FROM pg_locks w JOIN pg_locks h
    ON h.locktype=w.locktype AND h.database IS NOT DISTINCT FROM w.database
     AND h.classid=w.classid AND h.objid=w.objid AND h.objsubid=w.objsubid
    WHERE w.pid=$1 AND w.locktype='advisory' AND w.mode='ShareLock' AND NOT w.granted AND w.objsubid=1
     AND w.classid::bigint*4294967296+w.objid::bigint=634781904177022::bigint
     AND h.pid=pg_backend_pid() AND h.granted AND h.mode='ExclusiveLock'
     AND pg_backend_pid()=ANY(pg_blocking_pids(w.pid))`,[readerPid]);
   if(Number(waiting.rows[0].n)>0){blocked=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(blocked,'Legacy payment observer must actually wait behind the Source-aware writer');
  assert(!settled,'Adapter reader must remain pending until writer COMMIT');
  const waitWitnessMs=Date.now()-started;await input.holder.query('COMMIT');open=false;
  const outcome=await queued;queued=undefined;
  assert('error' in outcome&&outcome.error instanceof PostgresStorageUnavailable,'Queued adapter reader must refuse after writer COMMIT');
  // The adapter intentionally redacts SQL faults. Independently prove the same
  // committed state raises the exact raw guard, never merely a lock/statement timeout.
  await assert.rejects(input.holder.query({text:fundingSql,values:[canonicalJson(input.identity),input.digest,String(packet.row.payer),null]}),
   error=>error instanceof Error&&error.message.includes(rawRefusal));
  return {vectors:1,actualQueuedLegacyReader:true,freshRawObservationAfterWriterCommit:true,waitWitnessMs,exactDataLockWitness:true,readerPendingUntilWriterCommit:true,consumedFieldRawRefusal:true,noLockOrStatementBudgetRaised:true,installedWriterQualified:false,paymentActions:0,jobActions:0};
 }finally{try{if(open)await input.holder.query('ROLLBACK');if(queued)await queued;}finally{await channel.close();}}
}
