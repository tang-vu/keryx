import {DatabaseSync} from 'node:sqlite';
import {describe,it,expect,vi} from 'vitest';
import {installSqliteApplicationSchema} from '../sqlite-application-schema';
import {writeSqliteQueryRun} from '../query-run-record';
import {capturePostgresPublication,capturePublicationSourcePacket} from './publication-packet';
import {composePostgresPublication} from './publication-transport';
import type {PostgresDomainChannel} from './domain-channel';
import type {QueryRun} from '../../types';

const base=():QueryRun=>({id:'synthetic-json1-question',createdAt:'2026-11-15T00:00:00.000Z',question:'Actual visible question',answer:'SYNTHETIC_PAID_BODY',engine:'heuristic',budget:1,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline'});
describe('valid Source unknown question aliases',()=>{
 it.each([null,'Alias needle','NUL\0lone\ud800','\ufeffBOM\u2028\u2029',true,false,0,1.0000000000000002,.30000000000000004,Number.MIN_VALUE,Number.MAX_VALUE,{nested:'\0\ud800',number:.30000000000000004},['x',true,null]])('preserves Source original/scalar bytes for alias value %s',value=>{
  const run={'question\0suffix':value,...base()} as QueryRun,db=new DatabaseSync(':memory:');
  try{
   installSqliteApplicationSchema(db);writeSqliteQueryRun(db,run,false);
   const packet=JSON.parse(capturePostgresPublication(run).wire),pure=JSON.parse(capturePublicationSourcePacket(run).wire),row=db.prepare("SELECT question,data,lower(hex(CAST(json_extract(data,'$.question') AS BLOB))) question_hex,json_extract(data,'$.question') IS NULL question_null FROM query_runs").get()!;
   expect(Object.keys(JSON.parse(row.data as string))[0]).toBe('question\0suffix');expect(row.question).toBe(run.question);
   expect(Buffer.from(packet.originalHex,'hex').toString()).toBe(row.data);expect(packet).toEqual(pure);
   expect(packet.ownership).not.toHaveProperty('questionHex');expect(packet.privacy.scalarCells).not.toHaveProperty('question');
   expect(packet.privacy.questionFields).toContain('Actual visible question');expect(packet.privacy.eraseWire).not.toContain('question\\u0000suffix');
   if(row.question_null===1)expect(row.question_hex).toBe('');else expect(row.question_hex).not.toBe(Buffer.from(run.question).toString('hex'));
  }finally{db.close();}
 });
 it('keeps key/owner capture held while admitting qualified body text and unrelated raw keys',()=>{
  expect(()=>capturePostgresPublication({'question\0suffix':'Alias',...base()} as QueryRun)).not.toThrow();
  expect(()=>capturePostgresPublication({...base(),question:'mapped\0scalar'})).not.toThrow();
  for(const field of ['asker','parentId'] as const)for(const value of ['key\0suffix','key\ud800'])expect(()=>capturePostgresPublication({...base(),[field]:value})).toThrow();
  for(const input of [{...base(),id:'bad\0key'},{...base(),id:'prv_private'},{...base(),parentId:'prv_private'}])expect(()=>capturePostgresPublication(input)).toThrow();
 });
 it('retains distinct original UTF-16 string identities when SQLite bound scalars collide',()=>{
  const db=new DatabaseSync(':memory:');try{
   installSqliteApplicationSchema(db);
   const values=['\ud800','\udc00','\ufffd'],originals:string[]=[];
   for(const [index,question] of values.entries()){
    const run={...base(),id:'utf16-collision-'+index,question};writeSqliteQueryRun(db,run,false);
    const row=db.prepare('SELECT question,data FROM query_runs WHERE id=?').get(run.id)!;
    expect(row.question).toBe('\ufffd');const packet=JSON.parse(capturePostgresPublication(run).wire),original=Buffer.from(packet.originalHex,'hex').toString();expect(original).toBe(row.data);originals.push(original);
    const selected=JSON.parse(original).question as string;expect(JSON.stringify(selected)).toBe(JSON.stringify(question));expect(Buffer.from(selected,'utf16le').swap16().toString('hex')).toBe(['d800','dc00','fffd'][index]);
   }
   expect(new Set(originals).size).toBe(3);
  }finally{db.close();}
 });
});

describe('qualified publication text capture',()=>{
 const fields=['question','answer','engine','origin','mcpClient','paymentMode','confidence'] as const;
 it.each(fields)('retains exact Source scalar/original bytes for %s with leading BOM, NUL and UTF-16',field=>{
  const text='\ufeff\0pair\ud800\udc00 high\ud800 low\udfff',run={...base(),[field]:field==='confidence'?{level:text}:text,retained:{'opaque\0key':'RAW\0\ud800'}} as unknown as QueryRun,db=new DatabaseSync(':memory:');
  try{
   installSqliteApplicationSchema(db);writeSqliteQueryRun(db,run,false);
   const captured=capturePostgresPublication(run),packet=JSON.parse(captured.wire),row=db.prepare('SELECT * FROM query_runs WHERE id=?').get(run.id)!;
   expect(Buffer.from(packet.originalHex,'hex').toString()).toBe(row.data);expect(captured).toEqual(capturePublicationSourcePacket(run));
   const key=({mcpClient:'mcp_client',paymentMode:'payment_mode',confidence:'confidence_level'} as Record<string,string>)[field]??field;
   expect(row[key]).toBe(Buffer.from(text).toString());
   if(field!=='question'&&field!=='answer')expect(packet.privacy.scalarCells[key].boundHex).toBe(Buffer.from(String(row[key])).toString('hex'));
   expect(packet.row).not.toHaveProperty('question');expect(packet.row).not.toHaveProperty('answer');expect(packet.privacy.scalarCells).not.toHaveProperty('question');expect(packet.privacy).not.toHaveProperty('answerHex');
   expect(JSON.parse(String(row.data)).retained['opaque\0key']).toBe('RAW\0\ud800');
  }finally{db.close();}
 });
 it.each([true,false])('keeps readonly/closed admission ahead of caller getters (readonly=%s)',async readOnly=>{
  const getter=vi.fn(()=>{throw Error('Caller getter evaluated');}),poison=new Proxy({},{get:getter,ownKeys:getter}) as QueryRun,call=vi.fn<PostgresDomainChannel['call']>(),channel:PostgresDomainChannel={closed:!readOnly,call,async close(){}};
  await expect(composePostgresPublication(channel,readOnly)(poison)).rejects.toThrow('privacy_unavailable');expect(getter).not.toHaveBeenCalled();expect(call).not.toHaveBeenCalled();
 });
 it('detaches newly admitted text and raw extensions before a later caller mutation',()=>{
  const run={...base(),question:'\ufefffirst\0\ud800',extra:{text:'RAW\0\udc00'}},captured=capturePostgresPublication(run);run.question='mutated';run.extra.text='mutated';
  const original=JSON.parse(Buffer.from(JSON.parse(captured.wire).originalHex,'hex').toString());expect(original.question).toBe('\ufefffirst\0\ud800');expect(original.extra.text).toBe('RAW\0\udc00');
 });
});
