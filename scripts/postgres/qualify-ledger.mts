/** Actual PostgreSQL versus the genuine selected SQLite ledger capability. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,writeFileSync,unlinkSync,rmdirSync,existsSync,realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,dirname,resolve } from 'node:path';
import { canonicalJson } from '../../lib/canonical-json';
import type { QueryRun } from '../../lib/types';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { inspectStorageDeploymentManifest } from '../../lib/db/runtime-storage-config';
import { createEnrolledSqlitePublicLedgerRuns } from '../../lib/db/public-ledger-sqlite';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresPublicLedger } from '../../lib/db/postgres/ledger-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { sqliteLedgerProjection,heldLedgerProjectionSql } from './ledger-projection.mts';
import { ledgerRun } from '../../lib/operator-ledger/test-fixture';

export async function qualifyLedger(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-ledger-')),file=join(folder,'oracle.sqlite'),manifestPath=join(folder,'storage.json');
 const identity=validateStorageIdentity({...input.identity,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),provenanceDigest:'d8'.repeat(32)}),manifest=canonicalJson({format:'keryx-storage-deployment-v1',identity,backend:{kind:'sqlite',databasePath:file}}),oldPrivacy=process.env.KERYX_RUN_PRIVACY_ENABLED;
 const channel=createPostgresDomainChannel(input.options,input.identity,input.digest),native=composePostgresPublicLedger(channel,true).publicLedgerRuns;
 const stamp='2026-10-09T08:00:00.000Z',wallet='0x'+'e7'.repeat(20),source='synthetic-ledger-source',item='synthetic-ledger-item',q=(s:string)=>"'"+s.replaceAll("'","''")+"'";let vectors=0;
 const pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const owner=(action:(db:DatabaseSync)=>void)=>{const db=new DatabaseSync(file);try{registerStorageCapability(db,identity,()=>true);db.exec('BEGIN IMMEDIATE');action(db);db.exec('COMMIT');}finally{db.close();}};
 const oracle=(take:number)=>{const c=openVerifiedSqliteStorage(file,identity,{readOnly:true,applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(canonicalJson(inspectStorageDeploymentManifest({KERYX_STORAGE_MANIFEST:manifestPath})),manifest)});try{return createEnrolledSqlitePublicLedgerRuns(c.db).read(take);}finally{c.close();}};
 const sync=(db:DatabaseSync,id:string)=>{const row=db.prepare('SELECT data,created_at FROM query_runs WHERE id=?').get(id)!;assert(typeof row.data==='string');pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,engine,total_spent,total_to_creators,answer) VALUES(${q(id)},${q(String(row.created_at))},'Synthetic ledger',0,${q(row.data)}::json,'heuristic',0,0,'') ON CONFLICT(id) DO UPDATE SET data=excluded.data;`+heldLedgerProjectionSql(id,sqliteLedgerProjection(db,id)));};
 const save=(run:QueryRun,visibility='public')=>owner(db=>{if(db.prepare('SELECT 1 FROM query_runs WHERE id=?').get(run.id))db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(JSON.stringify(run),run.id);else writeSqliteQueryRun(db,run,false);db.prepare('UPDATE run_privacy SET visibility=? WHERE run_id=?').run(visibility,run.id);sync(db,run.id);pg(`INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(run.id)},${q(visibility)},${q(stamp)}) ON CONFLICT(run_id) DO UPDATE SET visibility=excluded.visibility;`);});
 const make=(suffix:string)=>ledgerRun({id:'synthetic-ledger-'+suffix,engine:'heuristic',decisions:[{...ledgerRun().decisions[0],sourceId:source,itemId:item,contentVersion:'version\0\ud800'}]});
 try{
  const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}writeFileSync(manifestPath,manifest,{mode:0o600});process.env.KERYX_RUN_PRIVACY_ENABLED='true';
  assert.deepEqual(await native.read(251),await oracle(251));vectors++;
  owner(db=>{db.prepare('INSERT INTO sources(id,name,wallet_address) VALUES(?,?,?)').run(source,'Synthetic ledger',wallet);db.prepare('INSERT INTO source_items(id,source_id,title) VALUES(?,?,?)').run(item,source,'Synthetic ledger item');});
  pg(`INSERT INTO public.sources(id,name,wallet_address) VALUES(${q(source)},'Synthetic ledger',${q(wallet)});INSERT INTO public.source_items(id,source_id,title) VALUES(${q(item)},${q(source)},'Synthetic ledger item');`);
  save(make('005'));save({...make('006'),origin:'mcp'});save(make('007'));save(make('008'),'unlisted');save(make('009'),'private');
  for(const take of [1,2,3,251]){assert.deepEqual(await native.read(take),await oracle(take));vectors++;}
  assert.equal((await native.read(3))[1],null);assert(!JSON.stringify(await native.read(251)).includes('PRIVATE-'));vectors++;
  for(const table of ['source_items','sources'] as const){const id=table==='sources'?source:item;owner(db=>{db.prepare(`UPDATE ${table} SET evidence_provenance='synthetic-demo' WHERE id=?`).run(id);});pg(`UPDATE public.${table} SET evidence_provenance='synthetic-demo' WHERE id=${q(id)};`);assert.deepEqual(await native.read(251),await oracle(251));assert.equal((await native.read(1))[0]?.references[0].synthetic,true);vectors++;}
  owner(db=>{db.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id=?").run('synthetic-ledger-007');});pg("UPDATE public.run_privacy SET visibility='private' WHERE run_id='synthetic-ledger-007';");assert.deepEqual(await native.read(251),await oracle(251));vectors++;
  pg("DELETE FROM keryx_storage.public_ledger_projection WHERE run_id='synthetic-ledger-006';");await assert.rejects(native.read(251));vectors++;owner(db=>sync(db,'synthetic-ledger-006'));
  owner(db=>{db.prepare('UPDATE query_runs SET data=? WHERE id=?').run(JSON.stringify({...make('005'),id:'mismatched'}),'synthetic-ledger-005');sync(db,'synthetic-ledger-005');});await assert.rejects(native.read(251));assert.throws(()=>oracle(251));vectors++;save(make('005'));
  owner(db=>{let sql='';for(let n=0;n<252;n++){const run=make('z'+String(n).padStart(3,'0'));if(n===251)run.origin='mcp';writeSqliteQueryRun(db,run,false);db.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id=?").run(run.id);const row=db.prepare('SELECT data FROM query_runs WHERE id=?').get(run.id)!;sql+=`INSERT INTO public.query_runs(id,created_at,question,budget,data,engine,total_spent,total_to_creators,answer) VALUES(${q(run.id)},${q(stamp)},'Synthetic scan',0,${q(String(row.data))}::json,'heuristic',0,0,'');INSERT INTO public.run_privacy(run_id,visibility,updated_at) VALUES(${q(run.id)},'public',${q(stamp)});`+heldLedgerProjectionSql(run.id,sqliteLedgerProjection(db,run.id));}pg(sql);});
  const capped=await native.read(251);assert.equal(capped.length,251);assert.equal(capped[0],null);assert.deepEqual(capped,await oracle(251));vectors++;
  owner(db=>{db.exec("DELETE FROM query_runs WHERE id LIKE 'synthetic-ledger-z%'");});pg("DELETE FROM public.query_runs WHERE id LIKE 'synthetic-ledger-z%';");
  await assert.rejects(composePostgresPublicLedger(channel,false).publicLedgerRuns.read(1));for(const take of [0,252,1.5])await assert.rejects(native.read(take));vectors++;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.read(251));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  const reader=createPostgresDomainChannel({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await composePostgresPublicLedger(reader,true).publicLedgerRuns.read(251),await oracle(251));vectors++;}finally{await reader.close();}
  await channel.close();await assert.rejects(native.read(1));vectors++;
  return {vectors,actualPostgres:true,genuineSelectedSqliteOracle:true,excludedPositionsConsumeScan:true,actual251PositionCap:true,noOriginalBodyExport:true,currentSourceAndItemProvenance:true,escapedContentVersionPreserved:true,missingDerivativeRefused:true,invalidOriginalRefused:true,readonlyRole:true,terminalClose:true,productionData:false,paidOperations:0,fullWriterQualified:false};
 }finally{
  try{await channel.close();pg("DELETE FROM public.query_runs WHERE id LIKE 'synthetic-ledger-%';DELETE FROM public.source_items WHERE id='synthetic-ledger-item';DELETE FROM public.sources WHERE id='synthetic-ledger-source';");}
  finally{if(oldPrivacy===undefined)delete process.env.KERYX_RUN_PRIVACY_ENABLED;else process.env.KERYX_RUN_PRIVACY_ENABLED=oldPrivacy;assert.equal(realpathSync(folder).toLowerCase(),resolve(folder).toLowerCase());assert.equal(dirname(folder).toLowerCase(),resolve(tmpdir()).toLowerCase());for(const path of [file,file+'-wal',file+'-shm',file+'-journal',manifestPath])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
 }
}
