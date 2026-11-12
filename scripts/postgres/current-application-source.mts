/** Complete current table SOURCE structure only. Application-domain behavioral
 * coverage, full data materialization and runtime selection remain separate. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { nativeApplicationDomainsReferenceSource } from './application-domains-source.mts';
export function nativeCurrentApplicationSource(){
 const domain=nativeApplicationDomainsReferenceSource();
 const additions=['application-tables.sql','current-application-columns.sql','application-indexes.sql'].map(name=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n'));
 if(additions.some(s=>Buffer.byteLength(s)>131072))throw new Error('Current application source bound exceeded');
 const declarations=[...additions[0].matchAll(/-- SQLite SOURCE ([a-z0-9_]+) sha256:([0-9a-f]{64})/g)];
 if(declarations.length!==34||new Set(declarations.map(m=>m[1])).size!==34)throw new Error('Current table declaration inventory refused');
 const source=new DatabaseSync(':memory:');
 try{
  source.exec('BEGIN');installMainnetApplicationSchema(source,{publicReferenceArchive:true});installNativeUserDomainSchema(source);source.exec('COMMIT');
  for(const declaration of declarations){const row=source.prepare("SELECT sql FROM sqlite_schema WHERE type='table' AND name=?").get(declaration[1]);
   if(!row||typeof row.sql!=='string'||createHash('sha256').update(row.sql).digest('hex')!==declaration[2])throw new Error('Current table SOURCE changed; review native declaration');}
  const indexes=[...additions[2].matchAll(/-- SQLite INDEX ([a-z0-9_]+) sha256:([0-9a-f]{64})/g)];
  if(indexes.length!==22||new Set(indexes.map(m=>m[1])).size!==22)throw new Error('Current index inventory refused');
  for(const index of indexes){const row=source.prepare("SELECT sql FROM sqlite_schema WHERE type='index' AND name=?").get(index[1]);
   if(!row||typeof row.sql!=='string'||createHash('sha256').update(row.sql).digest('hex')!==index[2])throw new Error('Current index SOURCE changed; review native declaration');}
 }finally{source.close();}
 const sql=domain.sql+'\n'+additions.join('\n');
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Current table structure only. Ephemeral SQLite writer IDs map to empty native transaction context; materialization, domain coverage and production cutover are unqualified.'});
}
