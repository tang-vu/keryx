/** Real fresh SQLite Source, sealed DATA only. No Native target/factory proof. */
import { afterEach,expect,it,vi } from 'vitest';
import { appendFileSync,chmodSync,copyFileSync,lstatSync,mkdtempSync,readFileSync,readdirSync,rmdirSync,unlinkSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname,join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const forbidden=vi.hoisted(()=>{
 vi.stubEnv('KERYX_NETWORK','arc');vi.stubEnv('NEXT_PUBLIC_KERYX_NETWORK','arc');vi.stubEnv('KERYX_FORCE_OFFLINE','0');
 for(const key of ['KERYX_REGISTRY_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS','KERYX_REGISTRY_READ_ADDRESS','NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS'])vi.stubEnv(key,'0x'+'ef'.repeat(20));
 for(const key of ['AGENT_FUNDER_PRIVATE_KEY','BUYER_PRIVATE_KEY','DEPLOYER_PRIVATE_KEY','KERYX_PRIVATE_TREASURY_PRIVATE_KEY','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY','CONTENT_MASTER_KEY','KERYX_REGISTRY_ORIGINS','NEXT_PUBLIC_KERYX_REGISTRY_ORIGINS'])vi.stubEnv(key,'');
 for(const key of ['KERYX_STORAGE_MANIFEST','KERYX_SQLITE_PATH','KERYX_USDC_ADDRESS','KERYX_GATEWAY_WALLET','KERYX_GATEWAY_MINTER','KERYX_MAX_TIMEOUT_SECONDS'])vi.stubEnv(key,undefined);
 const fetch=vi.fn(()=>{throw Error('No outbound I/O');}),pg=vi.fn(()=>{throw Error('No target access');});vi.stubGlobal('fetch',fetch);return {fetch,pg};
});
vi.mock('pg',()=>({Client:class{constructor(){forbidden.pg();}}}));
import { canonicalJson } from '../../lib/canonical-json';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences,registerStorageCapability } from '../../lib/db/storage-identity-sqlite';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity,type StorageIdentity } from '../../lib/db/storage-identity';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { nativeMaterializationProfile } from '../../lib/db/postgres/runtime-profile';
import { captureNativeProjectionSource } from './materialize-native-projections.mts';
import { inspectTypedDeltaSnapshot,type TypedDeltaRequest } from './typed-snapshot-delta.mts';
import { HELD_CATCHUP_INPUT_LIMITS,prepareHeldNativeCatchupInput } from './held-native-catchup-input.mts';
import type { QueryRun } from '../../lib/types';
const hash=(wire:string|Buffer)=>createHash('sha256').update(wire).digest('hex'),folders:string[]=[];
afterEach(()=>{expect(forbidden.pg).not.toHaveBeenCalled();expect(forbidden.fetch).not.toHaveBeenCalled();
 for(const folder of folders.splice(0)){for(const leaf of readdirSync(folder)){const path=join(folder,leaf);if(lstatSync(path).isDirectory()){for(const f of readdirSync(path))unlinkSync(join(path,f));rmdirSync(path);}else unlinkSync(path);}rmdirSync(folder);}
});
const run=(id='run-a'):QueryRun=>({id,createdAt:'2026-11-15T07:00:00.123456789+07:00',question:'Question\0\ud800',answer:'Answer\0\udfff',engine:'heuristic',budget:1,totalSpent:0.1,totalToCreators:0.05,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline'});
const identity=():StorageIdentity=>validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'a'.repeat(64)});
async function fixture(seed:(db:DatabaseSync)=>void=()=>{},change:(db:DatabaseSync,id:StorageIdentity)=>void=()=>{}){
 const folder=mkdtempSync(join(tmpdir(),'keryx-held-input-'));chmodSync(folder,0o700);folders.push(folder);
 const old=join(folder,'before.sqlite'),next=join(folder,'after.sqlite'),selected=identity(),db=new DatabaseSync(old);
 try{db.exec('PRAGMA journal_mode=DELETE;BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);seed(db);insertStorageIdentity(db,selected);installStorageFences(db,selected);db.exec('COMMIT');}finally{db.close();}
 chmodSync(old,0o600);copyFileSync(old,next);chmodSync(next,0o600);const owner=new DatabaseSync(next);
 try{registerStorageCapability(owner,selected,()=>true);change(owner,selected);}finally{owner.close();}
 const before={path:old,sha256:hash(readFileSync(old))},after={path:next,sha256:hash(readFileSync(next))},inventory=await inspectTypedDeltaSnapshot(before);
 const wire=canonicalJson({format:'keryx-native-held-data-baseline-metadata-v1',profileMode:'development-current510-data-only',catalogSha256:nativeMaterializationProfile('development-current510-data-only').catalogSha256,targetState:'held',sequence:2,snapshotSha256:before.sha256,schemaSha256:inventory.schemaSha256,identityDigest:inventory.identityDigest,dataDigest:inventory.dataDigest});
 return {folder,selected,delta:{before,after,priorTarget:{wire,expectedSha256:hash(wire)}} satisfies TypedDeltaRequest};
}
const frames=(path:string)=>readFileSync(path,'utf8').trimEnd().split('\n').map(w=>JSON.parse(w));
it('seals exact typed changes + affected raw scalar projections, checksums, census and all9 without target access',async()=>{
 const f=await fixture(db=>writeSqliteQueryRun(db,run(),false),db=>writeSqliteQueryRun(db,{...run(),answer:'Changed\0\ud800',trace:[{raw:'\udfff'}] as never},true));
 const result=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder}),wire=readFileSync(result.path),records=frames(result.path);
 expect(result).toMatchObject({targetVerified:false,applicationAuthority:false,nativeFactoryQualified:false,targetWrites:0});
 expect(result.bytes).toBe(wire.length);expect(result.sha256).toBe(hash(wire));expect(records[0].identity).toEqual(f.selected);expect(records.at(-1)).toEqual(result.completion);
 expect(result.completion).toMatchObject({delta:{changes:1,updates:1},affectedProjectionPackets:1,affectedOfferOrders:0,independentApplierQualificationRequired:true});
 const p=records.find(r=>r.format==='keryx-held-native-catchup-projection-v1');expect(p.before.rows).toHaveLength(5);expect(p.after.rows).toHaveLength(5);
 const priv=p.after.rows.find((r:{table:string})=>r.table==='run_privacy_projection').row;
 expect(Buffer.from(priv.answer_scalar,'hex').toString()).toBe('Changed\0�');expect(Buffer.from(priv.scalar_cells.created_at.boundHex,'hex').toString()).toBe(run().createdAt);
 const deltaWire=records.filter(r=>r.format==='keryx-typed-snapshot-delta-batch-v1').map(r=>JSON.stringify(r)+'\n').join('');expect(hash(deltaWire)).toBe(result.completion.delta.deltaDigest);expect(Buffer.byteLength(deltaWire)).toBe(result.completion.delta.deltaBytes);
 const content=wire.subarray(0,result.completion.bytesBeforeCompletion);expect(hash(content)).toBe(result.completion.contentSha256);
 expect(hash(readFileSync(f.delta.before.path))).toBe(f.delta.before.sha256);expect(hash(readFileSync(f.delta.after.path))).toBe(f.delta.after.sha256);
 expect(result.completion.delta.tables).toBe(94);expect(result.completion.beforeProjectionCensus.domains).toHaveLength(12);expect(result.completion.beforeProjectionCensus.packets).toBe(1);expect(result.completion.afterProjectionCensus.packets).toBe(1);
 expect(lstatSync(result.path).nlink).toBe(1);if(process.platform!=='win32')expect(lstatSync(result.path).mode&0o077).toBe(0);
});
it('hashes unchanged complete Source census without duplicating unchanged packets into the spool',async()=>{
 const f=await fixture(db=>{writeSqliteQueryRun(db,run(),false);writeSqliteQueryRun(db,run('run-b'),false);});
 const source=new DatabaseSync(f.delta.before.path,{readOnly:true});try{source.exec('PRAGMA query_only=ON;BEGIN');expect((await captureNativeProjectionSource(source,{family:'run',id:'run-a'})).rows).toHaveLength(5);}finally{source.close();}
 const result=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder});expect(result.frames).toBe(2);expect(result.completion.delta.changes).toBe(0);
 expect(result.completion.affectedProjectionPackets).toBe(0);expect(result.completion.beforeProjectionCensus).toEqual(result.completion.afterProjectionCensus);expect(result.completion.beforeProjectionCensus.packets).toBe(2);
});
it('captures inserts/deletes separately and preserves shared metadata row/digest inputs',async()=>{
 const f=await fixture(db=>writeSqliteQueryRun(db,run(),false),db=>{db.prepare('DELETE FROM query_runs WHERE id=?').run(run().id);writeSqliteQueryRun(db,run('run-z'),false);});
 const result=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder}),packets=frames(result.path).filter(r=>r.format==='keryx-held-native-catchup-projection-v1');
 expect(result.completion.delta).toMatchObject({inserts:2,deletes:1});expect(packets).toHaveLength(2);expect(packets[0].after).toBeNull();expect(packets[1].before).toBeNull();
 const db=new DatabaseSync(f.delta.after.path,{readOnly:true});try{db.exec('PRAGMA query_only=ON;BEGIN');expect(packets[1].after).toEqual(await captureNativeProjectionSource(db,{family:'run',id:'run-z'}));}finally{db.close();}
});
it('observes hidden offer rowid even when every typed value and delta digest is unchanged',async()=>{
 const f=await fixture(db=>db.prepare('INSERT INTO article_offers VALUES(?,?,?,?,?,?,?,?,?,?)').run('source','item','offer','v1',1,1800000000,'signer','nonce','signature','Source clock'),db=>db.exec('UPDATE article_offers SET rowid=71'));
 const result=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder}),orders=frames(result.path).filter(r=>r.format==='keryx-held-native-catchup-offer-order-v1');
 expect(result.completion.delta.changes).toBe(0);expect(orders).toHaveLength(1);expect(orders[0]).toMatchObject({before:{sourceOrder:'1'},after:{sourceOrder:'71'}});
 expect(result.completion.beforeOfferOrderDigest).not.toBe(result.completion.afterOfferOrderDigest);
});
it('carries observed payment Source fields only, never invents first/native-projection authority',async()=>{
 const f=await fixture(db=>db.prepare("INSERT INTO payment_events(id,created_at,kind,source_name,amount_usdc,network,settled,settlement_status) VALUES(?,?,'creator','old',0.01,'eip155:5042',0,'pending')").run('payment','raw clock'),db=>db.exec("UPDATE payment_events SET source_name='new'"));
 const result=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder}),p=frames(result.path).find(r=>r.format==='keryx-held-native-catchup-projection-v1');
 expect(result.completion.holds).toContain('immutable-payment-first-wire');expect(p.after.payment).toMatchObject({rowWire:expect.any(String),sha256:expect.any(String),projection:expect.any(Object),unprojectedFields:expect.any(Array)});
 expect(Object.keys(p.after.payment).join(',')).not.toContain('native_projection');expect(JSON.stringify(p)).not.toContain('original_wire');expect(p.after.rows).toEqual([]);
});
it.each(['spool','change','projection'] as const)('refuses the complete candidate on a lower %s byte bound and deletes only its partial spool',async bound=>{
 const f=await fixture(db=>writeSqliteQueryRun(db,run(),false),db=>writeSqliteQueryRun(db,{...run(),answer:'changed'},true));
 const good=await prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder}),known=new Set(readdirSync(f.folder));
 const limits=bound==='spool'?{spoolBytes:good.bytes-256}:bound==='change'?{changeFrameBytes:1}:{projectionFrameBytes:Buffer.byteLength(JSON.stringify(frames(good.path)[0]))+1};
 await expect(prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder,limits})).rejects.toMatchObject({code:bound==='spool'?'spool_bound':'frame_bound'});
 expect(new Set(readdirSync(f.folder))).toEqual(known);expect(hash(readFileSync(good.path))).toBe(good.sha256);
});
it('rejects foreign/stale receipts, missing/altered full Source schema/fences and late file mutation with no seal',async()=>{
 const f=await fixture(),bad=structuredClone(f.delta);bad.priorTarget.expectedSha256='f'.repeat(64);
 expect(()=>prepareHeldNativeCatchupInput({delta:bad,spoolDirectory:f.folder})).toThrow();expect(readdirSync(f.folder).sort()).toEqual(['after.sqlite','before.sqlite']);
 const owner=new DatabaseSync(f.delta.after.path);try{owner.exec('DROP TRIGGER storage_identity_no_update');owner.prepare('UPDATE keryx_storage_identity SET identity=?').run(JSON.stringify({...f.selected,storageId:randomUUID()}));}finally{owner.close();}
 await expect(prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder})).rejects.toMatchObject({code:'snapshot_hash'});
 const fresh=await fixture(db=>writeSqliteQueryRun(db,run(),false));const pending=prepareHeldNativeCatchupInput({delta:fresh.delta,spoolDirectory:fresh.folder});queueMicrotask(()=>appendFileSync(fresh.delta.after.path,Buffer.from([0])));
 await expect(pending).rejects.toBeInstanceOf(Error);expect(readdirSync(fresh.folder).sort()).toEqual(['after.sqlite','before.sqlite']);
});
it('refuses partial application schema and omitted identity/fences without constructing any target',async()=>{
 const f=await fixture(),db=new DatabaseSync(f.delta.after.path);try{db.exec('DROP TABLE query_runs');}finally{db.close();}
 const altered={...f.delta,after:{...f.delta.after,sha256:hash(readFileSync(f.delta.after.path))}};
 await expect(prepareHeldNativeCatchupInput({delta:altered,spoolDirectory:f.folder})).rejects.toMatchObject({code:'input_unavailable_source-after'});
 expect(readdirSync(f.folder).sort()).toEqual(['after.sqlite','before.sqlite']);
});
it('captures caller values before await and never executes getter-based input or raises a bound',async()=>{
 let gets=0;expect(()=>prepareHeldNativeCatchupInput({get delta(){gets++;throw Error('getter');},spoolDirectory:'x'} as never)).toThrow();expect(gets).toBe(0);
 const f=await fixture();expect(()=>prepareHeldNativeCatchupInput({delta:f.delta,spoolDirectory:f.folder,limits:{spoolBytes:HELD_CATCHUP_INPUT_LIMITS.spoolBytes+1}})).toThrow();
 const oversized=structuredClone(f.delta);oversized.priorTarget.wire='x'.repeat(8193);expect(()=>prepareHeldNativeCatchupInput({delta:oversized,spoolDirectory:f.folder})).toThrow();
 const input={delta:structuredClone(f.delta),spoolDirectory:f.folder},pending=prepareHeldNativeCatchupInput(input);input.delta.after.sha256='0'.repeat(64);input.spoolDirectory=dirname(f.folder);
 expect((await pending).completion.delta.changes).toBe(0);
});
