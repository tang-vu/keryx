/** Selected mainnet Source closure; no rights issuer, signature, provider,
 * wallet, payment, historical activation or job is executed. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { SqliteAdapter } from '../../lib/db/sqlite-adapter';
import type { KeryxDB } from '../../lib/db/keryx-db';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import { createPostgresDomainChannel } from '../../lib/db/postgres/domain-channel';
import { composePostgresScholarly } from '../../lib/db/postgres/scholarly-transport';

export async function qualifyScholarly(input:{options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;sourceClaims:Pick<KeryxDB,'getSource'>;ownerSql:(sql:string)=>string}){
 const identity=validateStorageIdentity(input.identity);assert.equal(identity.authorityMode,'mainnet-real');assert.equal(input.options.endpoint.kind,'loopback');
 const folder=mkdtempSync(join(tmpdir(),'keryx-native-scholarly-')),file=join(folder,'source.sqlite'),id='synthetic-scholarly-'+randomUUID(),at=new Date().toISOString(),wallet=`0x${'62'.repeat(20)}`,q=(v:string)=>"'"+v.replaceAll("'","''")+"'",held=(sql:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+sql+"UPDATE keryx_storage.control SET mode='active';COMMIT;"),channel=createPostgresDomainChannel(input.options,identity,input.digest),native=composePostgresScholarly(channel,identity,input.digest,input.sourceClaims);let source:ReturnType<typeof openVerifiedSqliteStorage>|undefined,vectors=0,inserted=false;
 try{const seed=new DatabaseSync(file);try{seed.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(seed,{publicReferenceArchive:true});installNativeUserDomainSchema(seed);seed.prepare('INSERT INTO sources(id,name,url,description,wallet_address,fetch_price,tags,authors,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id,'Synthetic scholarly closure','https://scholarly.example/','Public fixture',wallet,.01,'[]','[]',at);insertStorageIdentity(seed,identity);installStorageFences(seed,identity);seed.exec('COMMIT');}finally{seed.close();}
  held(`INSERT INTO public.sources(id,name,url,description,wallet_address,fetch_price,tags,authors,created_at) VALUES(${q(id)},'Synthetic scholarly closure','https://scholarly.example/','Public fixture',${q(wallet)},0.01,'[]'::jsonb,'[]'::jsonb,${q(at)});`);inserted=true;
  source=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});const core=SqliteAdapter.assembleConnectionCore(source.db,identity,()=>assert.deepEqual(assertVerifiedSqliteConnection(source!.db),identity));assert(!source.db.prepare('PRAGMA table_info(sources)').all().some(row=>row.name==='scholarly_enrolled'));assert.equal(source.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE 'scholarly_%'").get()!.n,0);
  for(const sourceId of [id,id+'-missing']){assert.equal(await native.getPaperState(sourceId),await core.getPaperState(sourceId));vectors++;}
  const poison=new Proxy({},{get(){throw Error('signed input inspected');}}) as never;
  for(const [operation,args,message] of [['beginPaperEnrollment',[poison,poison],'Scholarly enrollment is unsupported'],['submitPaper',[poison],'Scholarly enrollment is unsupported'],['reviewPaper',[poison],'Scholarly review is unsupported']] as const){for(const port of [core,native]){const method=port[operation] as (...args:never[])=>Promise<unknown>;await assert.rejects(method.apply(port,args as never),new RegExp(message));}vectors++;}
  assert.equal(await native.getPaperAdmission('synthetic-nonce'),await core.getPaperAdmission('synthetic-nonce'));vectors++;
  input.ownerSql("UPDATE keryx_storage.control SET mode='held';");try{await assert.rejects(native.getPaperAdmission('synthetic-nonce'));await assert.rejects(native.getPaperState(id));vectors++;}finally{input.ownerSql("UPDATE keryx_storage.control SET mode='active';");}
  return {vectors,actualVerifiedMainnetSqliteCore:true,actualNativeRuntimeGuard:true,actualSourceReaderDependency:true,selectedSchemaHasNoRightsTables:true,writesRefusedBeforePayloadOrProvider:true,admissionNull:true,newSqlFunctions:0,historicalActivation:false,fullWriterQualified:false,providerActions:0,signatureActions:0,paymentActions:0,jobExecutions:0,productionData:false};
 }finally{await channel.close();source?.close();if(inserted)held(`DELETE FROM public.sources WHERE id=${q(id)};`);for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
}
