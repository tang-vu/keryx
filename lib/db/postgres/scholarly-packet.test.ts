import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync,existsSync,unlinkSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARC_MAINNET_PROFILE as profile } from '../../arc-network-profile';
import { installMainnetApplicationSchema } from '../mainnet-application-schema';
import { installNativeUserDomainSchema } from '../native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../storage-identity-sqlite';
import { openVerifiedSqliteStorage,assertVerifiedSqliteConnection } from '../storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../enrolled-sqlite-schema-profile';
import { STORAGE_MAINNET_PROFILE_DIGEST,validateStorageIdentity } from '../storage-identity';
import { SqliteAdapter } from '../sqlite-adapter';
import { selectedScholarlyState,selectedScholarlyWrite } from './scholarly-packet';

it('matches the actual selected enrolled Source five-method closure without a historical rights issuer',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'keryx-scholarly-source-')),file=join(folder,'source.sqlite'),identity=validateStorageIdentity({format:'keryx-mainnet-storage-identity-v1',authorityMode:'mainnet-real',network:profile.networkId,profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,deploymentId:randomUUID(),storageId:randomUUID(),enrollmentId:randomUUID(),enrolledAt:new Date().toISOString(),provenanceDigest:'19'.repeat(32)});let selected:ReturnType<typeof openVerifiedSqliteStorage>|undefined;
 try{const db=new DatabaseSync(file);try{db.exec('BEGIN IMMEDIATE');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.prepare('INSERT INTO sources(id,name,url,description,wallet_address,fetch_price,tags,authors,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-paper-0','Synthetic paper','https://paper.example/','Public fixture',`0x${'56'.repeat(20)}`,.01,'[]','[]',new Date().toISOString());insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT');}finally{db.close();}
  selected=openVerifiedSqliteStorage(file,identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>{}});const core=SqliteAdapter.assembleConnectionCore(selected.db,identity,()=>expect(assertVerifiedSqliteConnection(selected!.db)).toEqual(identity));
  for(const id of ['missing','synthetic-paper-0'])expect(selectedScholarlyState(await core.getSource(id))).toBe(await core.getPaperState(id));
  // The selected application schema intentionally has no scholarly column or
  // rights tables. Exercise the defensive marker branch separately; adding a
  // column and inventing a selected profile would not be genuine Source proof.
  expect(selected.db.prepare('PRAGMA table_info(sources)').all().some(row=>row.name==='scholarly_enrolled')).toBe(false);expect(()=>selectedScholarlyState({scholarlyEnrolled:true} as never)).toThrow('Scholarly rights are unsupported on enrolled native storage');expect(await core.getPaperAdmission('untrusted-nonce')).toBeNull();
  const poison=new Proxy({},{get(){throw Error('input evaluated');}}) as never;await expect(core.beginPaperEnrollment(poison,poison)).rejects.toThrow('Scholarly enrollment is unsupported on enrolled native storage');await expect(core.submitPaper(poison)).rejects.toThrow('Scholarly enrollment is unsupported on enrolled native storage');await expect(core.reviewPaper(poison)).rejects.toThrow('Scholarly review is unsupported on enrolled native storage');for(const action of ['enroll','submit','review'] as const)expect(()=>selectedScholarlyWrite(action)).toThrow(action==='review'?'Scholarly review is unsupported on enrolled native storage':'Scholarly enrollment is unsupported on enrolled native storage');
  expect(selected.db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name LIKE 'scholarly_%'").get()!.n).toBe(0);
 }finally{selected?.close();for(const path of [file,file+'-wal',file+'-shm',file+'-journal'])if(existsSync(path))unlinkSync(path);rmdirSync(folder);}
});
