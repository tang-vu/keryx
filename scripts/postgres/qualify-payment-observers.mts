/** Fresh dedicated synthetic Source intake + actual fixed native read protocol.
 * No requiredOriginal, provider, wallet, transfer or complete writer is opened. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'pg';
import { canonicalJson } from '../../lib/canonical-json';
import type { PaymentRecord } from '../../lib/types';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { storageIdentityDigest,validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresPaymentObservations } from '../../lib/db/postgres/payment-observation-transport';
import { composePostgresPaymentEvents } from '../../lib/db/postgres/payment-events-transport';
import { PAYMENT_EVENT_FIELDS,type PaymentEventRow } from '../../lib/db/postgres/payment-events-packet';
import { captureObservedPaymentSource } from './payment-original-source.mts';

export async function qualifyPaymentObservers(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;contentionClient:Client;ownerSql:(sql:string)=>string}){
 const identity=validateStorageIdentity(input.identity),identitySha=storageIdentityDigest(identity),q=(v:string)=>"'"+v.replaceAll("'","''")+"'";
 const folder=mkdtempSync(join(tmpdir(),'keryx-payment-observers-')),file=join(folder,'source.sqlite'),prefix='synthetic-observers-'+randomUUID()+':';
 const channel=createPostgresDomainChannel(input.options,identity,input.digest),native=composePostgresPaymentObservations(channel),writer=composePostgresPaymentEvents(channel,false);
 let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,wrong:ReturnType<typeof createPostgresDomainChannel>|undefined,reader:ReturnType<typeof createPostgresDomainChannel>|undefined,vectors=0;
 const held=(sql:string)=>{try{return input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;");}catch(error){input.ownerSql('ROLLBACK;');throw error;}};
 const emptyWriters=()=>assert.equal(input.ownerSql('SELECT (SELECT count(*) FROM keryx_storage.writer)+(SELECT count(*) FROM public.browser_journal_writer)+(SELECT count(*) FROM public.browser_signing_v2_writer)+(SELECT count(*) FROM public.browser_signing_v3_writer);'),'0');
 try{
  // A dedicated fresh fixture is mandatory: never adopt a Native row or infer
  // a missing Original. Actual Source cells are observed after SQLite binding.
  const seed=new DatabaseSync(file);try{
   seed.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);
   const base:PaymentEventRow={id:'',created_at:'2026-11-15T00:00:00.000Z',kind:'citation',query_id:prefix+'small',source_id:prefix+'source',source_name:'Synthetic',payer:'0x'+'11'.repeat(20),payee:'0x'+'22'.repeat(20),amount_usdc:.0157,weight:null,rationale:null,tx_hash:null,network:identity.network,settled:0,settlement_status:'pending',authorization_id:'synthetic-nonce',authorization_expires_at:null,grant_epoch:null,origin:'engine',item_id:null,item_title:null,item_url:null,content_version:null,item_published_at:null,offer_id:null,list_price_usdc:null,authorization_phase:null};
   const insert=seed.prepare('INSERT INTO payment_events('+PAYMENT_EVENT_FIELDS.join(',')+') VALUES('+PAYMENT_EVENT_FIELDS.map(()=>'?').join(',')+')');
   const add=(id:string,edit:Partial<PaymentEventRow>={})=>{const row={...base,id:prefix+id,authorization_id:prefix+id,...edit};insert.run(...PAYMENT_EVENT_FIELDS.map(k=>row[k]));};
   for(const [i,date] of ['\ufeffraw\0date\ud800','2026-11-15T01:00:00.123456+01:00','2026-11-15T00:00:00.0001Z',null,''].entries())add('raw-'+i,{created_at:date,source_name:'\ufeffsource\0lone\udfff',rationale:'literal\\ud800',tx_hash:'receipt\0raw',item_title:'\ufefftitle',weight:0,list_price_usdc:0,authorization_id:i===0?'':null});
   add('inbound',{kind:'inbound'});add('fee',{kind:'operating-fee'});add('prepared',{authorization_phase:'prepared'});add('cancelled',{authorization_phase:'cancelled_unexposed'});add('tie-a',{query_id:prefix+'ties'});add('tie-b',{query_id:prefix+'ties'});
   // Lifetime dataset >1000 is legal; only each selected collection is bounded.
   for(let i=0;i<1001;i++)add('bulk-'+String(i).padStart(4,'0'),{query_id:prefix+'bulk',source_id:prefix+'bulk-source',created_at:'2026-11-14T00:00:00.000Z'});
   insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');
  }finally{seed.close();}
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});
  const core=SqliteAdapter.assembleConnectionCore(source.db,identity,()=>assert.deepEqual(assertVerifiedSqliteConnection(source!.db),identity));
  const ids=source.db.prepare('SELECT id FROM payment_events ORDER BY id').all().map(r=>String(r.id)),captured=new Map(ids.map(id=>[id,captureObservedPaymentSource(source!.db,id)!]));
  assert(captured.size>1000);assert([...captured.values()].every(Boolean));
  const scalar=(key:string,value:string|number|null)=>value===null?'NULL':key==='settled'?value===1?'true':'false':typeof value==='number'?String(value):q(value);
  const preflight="DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.payment_events) OR EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals) THEN RAISE EXCEPTION 'payment observer Source intake requires empty target';END IF;END;$$;";
  let intake=preflight;for(const id of ids){const row=captured.get(id)!;intake+='INSERT INTO public.payment_events('+PAYMENT_EVENT_FIELDS.join(',')+') VALUES('+PAYMENT_EVENT_FIELDS.map(k=>scalar(k,row.projection[k])).join(',')+');';
   intake+=`INSERT INTO keryx_storage.payment_event_originals(payment_id,identity_digest,original_wire,original_sha256,current_wire,current_sha256,native_projection,unprojected_fields) SELECT p.id,${q(identitySha)},${q(row.rowWire)}::json,${q(row.sha256)},${q(row.rowWire)}::json,${q(row.sha256)},to_jsonb(p),ARRAY[${row.unprojectedFields.map(q).join(',')}]::text[] FROM public.payment_events p WHERE p.id=${q(id)};`;
   intake+=`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM keryx_storage.payment_event_originals o JOIN public.payment_events p ON p.id=o.payment_id WHERE o.payment_id=${q(id)} AND o.identity_digest=${q(identitySha)} AND o.original_wire::text=${q(row.rowWire)} AND o.current_wire::text=${q(row.rowWire)} AND o.original_sha256=${q(row.sha256)} AND o.current_sha256=${q(row.sha256)} AND o.native_projection=to_jsonb(p)) THEN RAISE EXCEPTION 'payment observer Source exact readback refused';END IF;END;$$;`;
  }
  intake+=`DO $$ BEGIN IF (SELECT count(*) FROM public.payment_events)<>${ids.length} OR (SELECT count(*) FROM keryx_storage.payment_event_originals)<>${ids.length} THEN RAISE EXCEPTION 'payment observer Source complete intake refused';END IF;END;$$;`;
  assert(Buffer.byteLength(intake)<=8388608);held(intake);vectors++;
  const same=(actual:PaymentRecord[],expected:PaymentRecord[],eligible?:PaymentRecord[])=>{
   // Source SQL tie order is unspecified and demonstrably differs between
   // its installed plans. Compare exact members within each raw-date cohort.
   const cohorts=(rows:PaymentRecord[])=>{const groups:Array<{date:unknown;members:string[]}>=[];for(const row of rows){let group=groups.at(-1);if(!group||group.date!==row.createdAt){group={date:row.createdAt,members:[]};groups.push(group);}group.members.push(canonicalJson(row));}return groups.map(g=>({...g,members:g.members.sort()}));};
   if(!eligible)assert.deepEqual(cohorts(actual),cohorts(expected));else{
    const a=cohorts(actual),e=cohorts(expected),all=cohorts(eligible);assert.deepEqual(a.map(g=>[g.date,g.members.length]),e.map(g=>[g.date,g.members.length]));
    for(let i=0;i<a.length;i++){const complete=all.find(g=>g.date===a[i].date)!;assert(complete);if(complete.members.length===a[i].members.length)assert.deepEqual(a[i],e[i]);else{assert.equal(i,a.length-1);assert.equal(new Set(a[i].members).size,a[i].members.length);assert(a[i].members.every(member=>complete.members.includes(member)));}}
   }vectors++;
  };
  same(await native.listPayments(100),await core.listPayments(100),await core.listPayments(-1));same(await native.listPendingPayments(100),await core.listPendingPayments(100),await core.listPendingPayments(-1));same(await native.listPaymentsByQuery(prefix+'small'),await core.listPaymentsByQuery(prefix+'small'));same(await native.listCreatorPaymentAttemptsByQuery(prefix+'small'),await core.listCreatorPaymentAttemptsByQuery(prefix+'small'));same(await native.listPaymentsBySource(prefix+'source'),await core.listPaymentsBySource(prefix+'source'));
  assert.equal((await native.listPaymentsByQuery(prefix+'small')).length,5);assert.equal((await native.listCreatorPaymentAttemptsByQuery(prefix+'small')).length,6);assert(!((await native.listPayments(100)).some(r=>['prepared','cancelled_unexposed'].includes(String(r.authorizationPhase)))));vectors++;
  assert.deepEqual(await native.listPayments(0),await core.listPayments(0));assert.deepEqual(await native.listPendingPayments(0),await core.listPendingPayments(0));await assert.rejects(native.listPayments(-1));await assert.rejects(native.listPayments(1.5));vectors++;
  for(const key of [prefix+'absent\0\ud800',prefix+'absent\ufeff']){assert.deepEqual(await native.listPaymentsByQuery(key),await core.listPaymentsByQuery(key));assert.deepEqual(await native.listPaymentsBySource(key),await core.listPaymentsBySource(key));vectors++;}
  assert.equal((await core.listPaymentsByQuery(prefix+'bulk')).length,1001);await assert.rejects(native.listPaymentsByQuery(prefix+'bulk'));await assert.rejects(native.listPaymentsBySource(prefix+'bulk-source'));await assert.rejects(native.listPayments(10000));vectors++;
  const scan=await native.scanPaymentRows(1000,1000),expectedScan=source.db.prepare('SELECT * FROM payment_events ORDER BY id LIMIT 1000 OFFSET 1000').all();assert.deepEqual(scan,expectedScan.map(row=>({...row})));assert.equal((await native.scanPaymentRows(0,1000)).length,1000);vectors++;
  reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},identity,input.digest);same(await composePostgresPaymentObservations(reader).listPaymentsByQuery(prefix+'small'),await core.listPaymentsByQuery(prefix+'small'));await reader.close();reader=undefined;emptyWriters();vectors++;
  const ties=await native.listPaymentsByQuery(prefix+'ties');same(ties,await core.listPaymentsByQuery(prefix+'ties'));assert.deepEqual(ties.map(r=>r.id),[prefix+'tie-a',prefix+'tie-b']);
  const id=prefix+'tie-a',before=captured.get(id)!;await core.settlePendingPayment(id,prefix+'tie-a','receipt\0lone\ud800');assert.equal(await writer.settlePendingPayment(id,prefix+'tie-a','receipt\0lone\ud800'),true);same(await native.listPaymentsByQuery(prefix+'ties'),await core.listPaymentsByQuery(prefix+'ties'));
  assert.equal(input.ownerSql(`SELECT original_sha256 FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`),before.sha256);emptyWriters();vectors++;
  // Private retention is protected independently of the read function.
  for(const sql of [`UPDATE keryx_storage.payment_event_originals SET original_wire=(original_wire::text||' ')::json,original_sha256=encode(sha256(convert_to(original_wire::text||' ','UTF8')),'hex') WHERE payment_id=${q(id)};`,`UPDATE keryx_storage.payment_event_originals SET identity_digest=repeat('0',64) WHERE payment_id=${q(id)};`,`UPDATE keryx_storage.payment_event_originals SET current_sha256=repeat('0',64) WHERE payment_id=${q(id)};`,`DELETE FROM keryx_storage.payment_event_originals WHERE payment_id=${q(id)};`]){assert.throws(()=>held(sql));vectors++;}
  wrong=createPostgresDomainChannel(input.options,{...identity,deploymentId:randomUUID()},input.digest);await assert.rejects(composePostgresPaymentObservations(wrong).listPayments(1));vectors++;
  // The genuine deferred fence prevents an active stale projection from
  // committing. Do not disable it merely to manufacture a read fault.
  assert.throws(()=>held(`UPDATE public.payment_events SET source_name='synthetic-drift' WHERE id=${q(id)};`));same(await native.listPaymentsByQuery(prefix+'ties'),await core.listPaymentsByQuery(prefix+'ties'));vectors++;
  assert.equal(input.ownerSql("SELECT count(*) FROM pg_proc WHERE oid='public.storage_application_read_group_8(jsonb,text,text,jsonb)'::regprocedure AND (octet_length(pg_get_functiondef(oid))>32768 OR octet_length(to_jsonb(pg_get_functiondef(oid))::text)>32768);"),'0');emptyWriters();vectors++;
  // No adoption or replay backfill: a public-only insertion must roll back.
  const missing=prefix+'missing-original';assert.throws(()=>held(`INSERT INTO public.payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,settlement_status) VALUES(${q(missing)},'2026-11-15T00:00:00.000Z','citation',${q(prefix+'missing')},${q(String(before.row.source_id))},'Synthetic',${q(String(before.row.payer))},${q(String(before.row.payee))},0.01,${q(identity.network)},false,'pending');`));assert.deepEqual(await native.listPaymentsByQuery(prefix+'missing'),[]);emptyWriters();vectors++;
  return {vectors,sourceRows:ids.length,selectedCollectionsNotLifetimeCap:true,genuineSelectedSqlite:true,exact27ObservedCells:true,immutableOriginalAndCurrentSha:true,sourceNullAndRawDateOrder:true,sourceBomNulAndScalarReplacement:true,sourceSqlUnspecifiedTiesIdRefinement:true,allFiveReaders:true,readerRoleAndNoWriterCapability:true,rawScanOnly:true,metricsActivated:false,unrelatedRawMetadataDoesNotPoison:true,missingOriginalAndStaleProjectionCannotCommit:true,foreignIdentityRefused:true,noNativeBackfill:true,zeroFunctionGrowth:true,completeQuotedGroupBound:true,authorityNulRowsRemainIntakeHold:true,fullWriterQualified:false,fundingActions:0,providerActions:0,realSignatures:0};
 }finally{await reader?.close();await wrong?.close();await channel.close();source?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
