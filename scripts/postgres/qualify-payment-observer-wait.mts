import assert from 'node:assert/strict';
import type {Client} from 'pg';
import {canonicalJson} from '../../lib/canonical-json';
import {createPostgresDomainChannel} from '../../lib/db/postgres/domain-channel';
import {PostgresStorageUnavailable,type PostgresConnectionOptions} from '../../lib/db/postgres/connection';
import type {StorageIdentity} from '../../lib/db/storage-identity';
import type {capturePaymentEvent} from '../../lib/db/postgres/payment-events-packet';
/** A real queued-reader probe, using a fixed synthetic/captured packet only.
 * It issues no provider action and creates no Source or installed-facade proof. */
export async function qualifyPaymentObserverWait(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;holder:Client},packet:ReturnType<typeof capturePaymentEvent>){
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest);let open=false,queued:Promise<void>|undefined;
 try{
  assert(packet.unprojectedFields.length>0);
  await channel.call('funding',[String(packet.row.payer),null]);
  await input.holder.query('BEGIN');open=true;
  await input.holder.query({text:"SELECT public.storage_payment_events($1::jsonb,$2::text,'record',$3::text)",values:[canonicalJson(input.identity),input.digest,JSON.stringify({rowWire:packet.rowWire,sha256:packet.sha256,projection:packet.projection,unprojectedFields:packet.unprojectedFields})]});
  queued=assert.rejects(channel.call('funding',[String(packet.row.payer),null]),error=>error instanceof PostgresStorageUnavailable);
  let blocked=false;const started=Date.now(),deadline=started+4000;
  while(Date.now()<deadline){
   // pg_locks is live; statistics snapshots in a long transaction must not
   // hide a backend that began waiting after its first pg_stat_activity read.
   const waiting=await input.holder.query("SELECT count(*)::text n FROM pg_locks WHERE locktype='advisory' AND NOT granted AND pg_backend_pid()=ANY(pg_blocking_pids(pid))");
   if(Number(waiting.rows[0].n)>0){blocked=true;break;}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert(blocked,'Legacy payment observer must actually wait behind the Source-aware writer');
  const waitWitnessMs=Date.now()-started;await input.holder.query('COMMIT');open=false;await queued;queued=undefined;
  return {vectors:1,actualQueuedLegacyReader:true,freshRawObservationAfterWriterCommit:true,waitWitnessMs,noLockOrStatementBudgetRaised:true,installedWriterQualified:false,paymentActions:0,jobActions:0};
 }finally{if(open)await input.holder.query('ROLLBACK');if(queued)await queued.catch(()=>{});await channel.close();}
}
