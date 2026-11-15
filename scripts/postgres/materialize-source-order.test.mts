/** Actual immutable SQLite Source observation and independent readback checks.
 * No PostgreSQL, containment waiver or installed facade proof is supplied. */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { insertStorageIdentity,installStorageFences } from '../../lib/db/storage-identity-sqlite';
import { STORAGE_MAINNET_PROFILE_DIGEST,type StorageIdentity } from '../../lib/db/storage-identity';
import { snapshotRows,snapshotTables,snapshotRowWire,type SnapshotTable } from './typed-snapshot.mts';
import { nativeMaterializationCell } from './native-materialization-codec.mts';
import { articleOfferSourceOrder,materializationSourceOrderColumn,materializedArticleOfferCells } from './materialize-native-snapshot.mts';

const identity:StorageIdentity={format:'keryx-mainnet-storage-identity-v1',deploymentId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',storageId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',network:'eip155:5042',authorityMode:'mainnet-real',profileDigest:STORAGE_MAINNET_PROFILE_DIGEST,enrollmentId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',enrolledAt:'2026-10-01T00:00:00.000Z',provenanceDigest:'dd'.repeat(32)};
function fixture(run:(db:DatabaseSync,table:SnapshotTable,ordinals:Map<string,string>)=>void){
 const db=new DatabaseSync(':memory:'),ordinals=new Map<string,string>();
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  // Deliberately unrelated key/date/insertion order. Preserve signed int64
  // extremes and values that cannot survive a JavaScript Number conversion.
  const rows=[['max','a',BigInt('9223372036854775807'),'2026-11-15T01:00:00.123456789+01:00'],['zero','z',BigInt(0),'2026-11-15T00:00:00.123456789Z'],['unsafe','m',BigInt('9007199254740993'),'2026-11-15T00:00:00.123456788Z'],['negative','b',BigInt(-7),'raw Source date'],['min','c',BigInt('-9223372036854775808'),'2026-11-15T01:00:00.123456789+01:00']] as const;
  for(const [id,item,ordinal,date] of rows){db.prepare('INSERT INTO article_offers(rowid,source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ordinal,'\uFEFFsource',item,id,'\uFEFFversion',-1,0,'MiXeD signer','raw nonce ','\uFEFFraw signature',date);ordinals.set(id,String(ordinal));}
  insertStorageIdentity(db,identity);installStorageFences(db,identity);db.exec('COMMIT;PRAGMA query_only=ON;BEGIN');
  const table=snapshotTables(db).find(t=>t.name==='article_offers')!;expect(table).toBeDefined();run(db,table,ordinals);
 }finally{db.close();}
}
const target=(table:SnapshotTable,extra?:{name:string;type:string})=>({name:table.name,columns:[...table.columns.map(name=>({name,type:name==='price_usdc6'||name==='expires_at'?'bigint':'text'})),...(extra?[extra]:[])],primary_key:['source_id','item_id'],parents:[]});
const digest=(db:DatabaseSync,table:SnapshotTable)=>{const hash=createHash('sha256');for(const row of snapshotRows(db,table,['source_id','item_id']))hash.update(snapshotRowWire(row)).update('\n');return hash.digest('hex');};
const text=(value:readonly unknown[])=>{expect(value[0]).toBe('text');return new TextDecoder('utf8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value[1] as string,'hex'));};

it('observes actual full signed rowids independent of PK, date and traversal while preserving the original typed94 inventory/digest',()=>fixture((db,table,ordinals)=>{
 const inventory=snapshotTables(db),before=digest(db,table);expect(inventory).toHaveLength(94);expect(table.columns).toHaveLength(10);expect(materializationSourceOrderColumn(table,target(table,{name:'source_order',type:'bigint'}))).toBe(true);
 for(const order of [[],['source_id','item_id'],['created_at']] as const)for(const row of snapshotRows(db,table,order)){
  const id=text(row[table.columns.indexOf('id')]),ordinal=articleOfferSourceOrder(db,table,row);expect(ordinal).toBe(ordinals.get(id));
  const cells=row.map((cell,i)=>nativeMaterializationCell(cell,['price_usdc6','expires_at'].includes(table.columns[i])?'bigint':'text'));
  expect(JSON.parse(JSON.stringify({cells,source_order:ordinal})).source_order).toBe(ordinals.get(id));
  expect(materializedArticleOfferCells(db,table,row,[...cells,ordinal])).toEqual(cells);
 }
 expect(snapshotTables(db)).toEqual(inventory);expect(digest(db,table)).toBe(before);expect(db.prepare('PRAGMA query_only').get()!.query_only).toBe(1);
}));
it('rejects an incorrect, rounded, missing or noncanonical ordinal even when all ten native cells match',()=>fixture((db,table)=>{
 const row=[...snapshotRows(db,table)].find(row=>text(row[table.columns.indexOf('id')])==='unsafe')!,cells=row.map((cell,i)=>nativeMaterializationCell(cell,['price_usdc6','expires_at'].includes(table.columns[i])?'bigint':'text'));
 for(const ordinal of ['9007199254740992','9007199254740994','+9007199254740993','09007199254740993',null])expect(()=>materializedArticleOfferCells(db,table,row,[...cells,ordinal])).toThrow();
 expect(()=>materializedArticleOfferCells(db,table,row,cells)).toThrow();expect(materializedArticleOfferCells(db,table,row,[...cells,'9007199254740993'])).toEqual(cells);
}));
it('admits only the exact target-only bigint field and keeps the legacy profile unchanged',()=>fixture((_db,table)=>{
 const legacy=target(table);legacy.columns.find(c=>c.name==='created_at')!.type='timestamp with time zone';expect(materializationSourceOrderColumn(table,legacy)).toBe(false);
 for(const extra of [{name:'source_order',type:'integer'},{name:'source_order',type:'text'},{name:'rowid',type:'bigint'},{name:'other',type:'bigint'}])expect(()=>materializationSourceOrderColumn(table,target(table,extra))).toThrow();
 const native=target(table,{name:'source_order',type:'bigint'});expect(()=>materializationSourceOrderColumn({...table,name:'sources'},{...native,name:'sources'})).toThrow();
 expect(()=>materializationSourceOrderColumn(table,{...native,columns:[...native.columns,{name:'extra',type:'text'}]})).toThrow();
 expect(()=>materializationSourceOrderColumn({...table,columns:[...table.columns,'source_order']},native)).toThrow();expect(()=>materializationSourceOrderColumn({...table,columns:table.columns.filter(c=>c!=='signature')},native)).toThrow();
}));
it('requires the immutable Source pin and refuses a key that does not identify a Source row',()=>fixture((db,table)=>{
 const row=[...snapshotRows(db,table)][0],changed=row.map((cell,i)=>i===table.columns.indexOf('item_id')?['text',Buffer.from('missing').toString('hex')] as const:cell);
 expect(()=>articleOfferSourceOrder(db,table,changed)).toThrow();db.exec('ROLLBACK');expect(()=>articleOfferSourceOrder(db,table,row)).toThrow();db.exec('PRAGMA query_only=OFF;BEGIN');expect(()=>articleOfferSourceOrder(db,table,row)).toThrow();
}));
it('looks up exact Source key bytes including BOM and embedded NUL without text decoding or truncation',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);
  for(const [source,ordinal] of [['\uFEFFsame\0a',BigInt(-3)],['\uFEFFsame\0b',BigInt(0)]] as const)db.prepare('INSERT INTO article_offers(rowid,source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ordinal,source,'same','offer'+ordinal,'v',0,0,'s','n','sig','same clock');
  db.exec('COMMIT;PRAGMA query_only=ON;BEGIN');const table=snapshotTables(db).find(t=>t.name==='article_offers')!,rows=[...snapshotRows(db,table,['source_id','item_id'])];
  expect(rows.map(row=>articleOfferSourceOrder(db,table,row))).toEqual(['-3','0']);
  // This is rowid observation only; scalar NUL native intake stays refused.
  expect(()=>nativeMaterializationCell(rows[0][table.columns.indexOf('source_id')],'text')).toThrow();
 }finally{db.close();}
});
