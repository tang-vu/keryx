/** Genuine selected SQLite chat producer for the compiled read fixture only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nativeAccountFixturePaths } from './native-account-fixture.mts';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { openVerifiedSqliteStorage } from '../../lib/db/storage-identity-connection';
import { supportedSqliteApplicationProfiles } from '../../lib/db/enrolled-sqlite-schema-profile';
import { createEnrolledSqliteChatAccountLinks } from '../../lib/db/chat-accounts-sqlite';
import type { AccountSnapshot } from '../../lib/accounts/contracts';
import { chatTokenHash } from '../../lib/chat-accounts/service';
import { randomAccountValue } from '../../lib/accounts/protocol';
import type { ChatRecipient,PendingChatLink } from '../../lib/chat-accounts/contracts';
export async function nativeChatFixture(folder:string,identity:StorageIdentity,snapshot:AccountSnapshot){
 const paths=nativeAccountFixturePaths(folder),manifest=readFileSync(paths[4],'utf8'),selected=openVerifiedSqliteStorage(paths[0],identity,{applicationProfiles:supportedSqliteApplicationProfiles(true),runtimeGuard:()=>assert.equal(readFileSync(paths[4],'utf8'),manifest)});
 try{
  const port=createEnrolledSqliteChatAccountLinks(selected.db);assert(port);
  const pending=(recipient:ChatRecipient):PendingChatLink=>{const issuedAt=Date.now();return {purpose:'chat-account-link-v1',tokenHash:chatTokenHash(randomAccountValue()),recipient,binding:snapshot.binding,issuedAt,expiresAt:issuedAt+300000};};
  const completed=pending({platform:'telegram',scope:'telegram',userId:'712345',channel:'712345'});await port.issue(completed);const link=await port.complete(completed.tokenHash,snapshot);
  const preview=pending({platform:'slack',scope:'T123',userId:'U123',channel:'D123'});await port.issue(preview);
  let sql='';const q=(s:string)=>"'"+s.replaceAll("'","''")+"'";
  for(const table of ['chat263_links','chat263_tokens'])for(const row of selected.db.prepare('SELECT * FROM '+table).all()){
   const keys=Object.keys(row);assert(keys.every(k=>/^[a-z][a-z0-9_]*$/.test(k)));sql+=`INSERT INTO public.${table}(${keys.join(',')}) VALUES(${keys.map(k=>{const v=row[k];if(v===null)return 'NULL';if(typeof v==='number'||typeof v==='bigint')return String(v);assert(typeof v==='string');return q(v);}).join(',')});`;
  }
  return {sql,observation:{link,preview,recipient:completed.recipient},tokenHashes:[completed.tokenHash,preview.tokenHash]};
 }finally{selected.close();}
}
