import {describe,it,expect,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readdirSync,unlinkSync,rmdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {SqliteAdapter} from '../sqlite-adapter';
import {installSqliteApplicationSchema} from '../sqlite-application-schema';
import {writeSqliteQueryRun} from '../query-run-record';
import {SYNTHETIC_EVIDENCE_NOTICE} from '../../research/evidence-provenance';
import type {EvidenceProvenanceLookup} from '../../research/evidence-provenance';
import type {QueryRun} from '../../types';
import {captureEvidenceProvenanceBatch,decodeEvidenceProvenanceBatch,captureSourceVerification,SOURCE_EVIDENCE_INPUT_BYTES} from './source-observation-packet';
const hex=(value:string)=>Buffer.from(value).toString('hex');
const wallet='0x'+'ab'.repeat(20);
function sourceFixture(){
 const root=resolve(tmpdir()),folder=mkdtempSync(join(root,'source-observation-unit-')),file=join(folder,'source.sqlite'),owner=new DatabaseSync(file);installSqliteApplicationSchema(owner);const source=new SqliteAdapter(file);
 return {owner,source,close(){source.close();owner.close();for(const name of readdirSync(folder)){expect(['source.sqlite','source.sqlite-wal','source.sqlite-shm','source.sqlite-journal']).toContain(name);const path=join(folder,name);expect(dirname(resolve(path))).toBe(resolve(folder));unlinkSync(path);}expect(dirname(resolve(folder))).toBe(root);rmdirSync(folder);}};
}
describe('Source observation packets',()=>{
 it('captures Source UTF8 binding, empty IDs and BOM without JSONB Unicode decoding',()=>{
  const input={sourceIds:['','a\0b','\ud800','\ufeffsource'],itemIds:['\udc00','\ud800\udc00']},captured=captureEvidenceProvenanceBatch(input);input.sourceIds[0]='changed';const wire=JSON.parse(captured.wire);
  expect(wire.sourceIdsHex[1]).toBe('610062');expect(wire.sourceIdsHex[2]).toBe('efbfbd');
  expect(wire.sourceIdsHex).toEqual(['',hex('a\0b'),hex('\ufffd'),hex('\ufeffsource')]);expect(wire.itemIdsHex).toEqual([hex('\ufffd'),hex('\ud800\udc00')]);expect(captured.wire).not.toContain('changed');
  expect(decodeEvidenceProvenanceBatch({format:'keryx-native-source-evidence-v1',sourceIdsHex:[hex('\ufeffsource')],items:[{idHex:hex('\ufffd'),sourceIdHex:null}]},captured)).toEqual(['source:\ufeffsource','item:null:\ufffd']);
 });
 it('admits the actual1000x256 worst Source strings inside its fixed input descriptor',()=>{
  const value='\uffff'.repeat(256),captured=captureEvidenceProvenanceBatch({sourceIds:Array(500).fill(value),itemIds:Array(500).fill(value)});expect(Buffer.byteLength(JSON.stringify([captured.wire]))).toBeLessThanOrEqual(SOURCE_EVIDENCE_INPUT_BYTES);
  expect(()=>captureEvidenceProvenanceBatch({sourceIds:[value+'x'],itemIds:[]})).toThrow();expect(()=>captureEvidenceProvenanceBatch({sourceIds:Array(501).fill('x'),itemIds:[]})).toThrow();
 });
 it.each(['unknown','duplicate','badHex','invalidUtf8','overlong','extra'] as const)('refuses %s response identities rather than emitting provenance',fault=>{
  const captured=captureEvidenceProvenanceBatch({sourceIds:['source'],itemIds:[]}),value={format:'keryx-native-source-evidence-v1',sourceIdsHex:[hex('source')],items:[]} as Record<string,unknown>;
  if(fault==='unknown')value.sourceIdsHex=[hex('other')];else if(fault==='duplicate')value.sourceIdsHex=[hex('source'),hex('source')];else if(fault==='badHex')value.sourceIdsHex=['AA'];else if(fault==='invalidUtf8')value.sourceIdsHex=['eda080'];else if(fault==='overlong')value.sourceIdsHex=[hex('x'.repeat(257))];else value.proof=true;
  expect(()=>decodeEvidenceProvenanceBatch(value,captured)).toThrow();
 });
 it('matches genuine Source flags for requested synthetic rows only and preserves scalar-bound Unicode',async()=>{
  const f=sourceFixture();try{
   for(const [id,provenance] of [['source','synthetic-demo'],['not-synthetic',null],['\ufffd','synthetic-demo'],['\ufeffsource','synthetic-demo'],['a\0b','synthetic-demo']] as const)f.owner.prepare('INSERT INTO sources(id,name,url,evidence_provenance) VALUES(?,?,?,?)').run(id,'Synthetic fixture','https://example.invalid/',provenance);
   f.owner.prepare('INSERT INTO source_items(id,source_id,title,content,evidence_provenance) VALUES(?,?,?,?,?)').run('item','source','Synthetic','Synthetic','synthetic-demo');
   const lookup={sourceIds:['source','not-synthetic','\ud800','\ufeffsource','a\0b','source'],itemIds:['item','missing']},captured=captureEvidenceProvenanceBatch(lookup);
   // The actual Source implementation on its own real constructor/DB. No
   // alternate facade, native proof, registration or injected guard is minted.
   const read=Reflect.get(f.source,'readEvidenceProvenance') as (lookup:EvidenceProvenanceLookup)=>Promise<ReadonlySet<string>>,oracle=await read.call(f.source,lookup);
   const packet={format:'keryx-native-source-evidence-v1',sourceIdsHex:['source','\ufffd','\ufeffsource','a\0b'].map(hex),items:[{idHex:hex('item'),sourceIdHex:hex('source')}]};expect(new Set(decodeEvidenceProvenanceBatch(packet,captured))).toEqual(oracle);
  }finally{f.close();}
 });
 it('the five actual Source nonempty QueryRun readers apply the same requested provenance',async()=>{
  vi.stubEnv('KERYX_RUN_PRIVACY_ENABLED','false');const f=sourceFixture();try{
   f.owner.prepare('INSERT INTO sources(id,name,url,evidence_provenance) VALUES(?,?,?,?)').run('synthetic-source','Synthetic','https://example.invalid/','synthetic-demo');
   const run={id:'synthetic-observation-run',parentId:'parent',asker:wallet,createdAt:'2026-11-15T00:00:00.000Z',question:'Synthetic',answer:'Synthetic answer',engine:'heuristic',budget:1,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[{sourceId:'synthetic-source',marker:'S1'}],trace:[]} as unknown as QueryRun;writeSqliteQueryRun(f.owner,run,false);
   const lists=await Promise.all([f.source.listFollowUps('parent'),f.source.listQueryRunsByAsker(wallet,10),f.source.listRecentQueries(10)]),single=await f.source.getQueryRun(run.id),iterated:QueryRun[]=[];for await(const value of f.source.iterateRecentQueries(10))iterated.push(value);
   for(const row of [...lists.flat(),single!,...iterated])expect(row.answer.startsWith(SYNTHETIC_EVIDENCE_NOTICE)).toBe(true);expect(lists.every(rows=>rows.length===1)&&iterated.length===1).toBe(true);
  }finally{f.close();vi.unstubAllEnvs();}
 });
 it.each(['https://example.invalid/feed','not a URL','feed\0tail','feed\ud800','\ufefffeed'])('uses exact Source source-verification input validation for %j',feedUrl=>{
  expect(JSON.parse(captureSourceVerification({sourceId:'source\ud800',walletAddress:wallet.toUpperCase(),feedUrl}))).toEqual({operation:'verify-if-unchanged',sourceIdHex:hex('source\ufffd'),walletHex:hex(wallet),feedUrlHex:hex(feedUrl)});
 });
 it('genuine Source verification binds current wallet and effective feed, including repeated updates',async()=>{
  const f=sourceFixture();try{f.owner.prepare('INSERT INTO sources(id,name,url,rss_url,wallet_address,verified) VALUES(?,?,?,?,?,0)').run('source','Synthetic','fallback\0\ufffd','',wallet.toUpperCase());
   const input={sourceId:'source',walletAddress:wallet,feedUrl:'fallback\0\ud800'};expect(await f.source.verifySourceIfUnchanged(input)).toBe(true);expect(await f.source.verifySourceIfUnchanged(input)).toBe(true);
   f.owner.prepare('UPDATE sources SET rss_url=?,verified=0 WHERE id=?').run('new-feed','source');expect(await f.source.verifySourceIfUnchanged(input)).toBe(false);expect(f.owner.prepare('SELECT verified FROM sources WHERE id=?').get('source')!.verified).toBe(0);
   expect(await f.source.verifySourceIfUnchanged({...input,feedUrl:'new-feed',walletAddress:'0x'+'cd'.repeat(20)})).toBe(false);expect(await f.source.verifySourceIfUnchanged({...input,feedUrl:'new-feed'})).toBe(true);
  }finally{f.close();}
 });
});
