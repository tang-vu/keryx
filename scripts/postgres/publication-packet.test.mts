import { describe,it,expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { capturePostgresPublication,capturePublicationSourcePacket } from '../../lib/db/postgres/publication-packet';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { sqlitePrivacyProjection } from './privacy-projection.mts';
import {sqlitePublicationScalarProjection} from './privacy-projection.mts';
import {publicationScalarCells,decodePublicationOriginalRead} from '../../lib/db/postgres/publication-scalar-text';
import type { QueryRun } from '../../lib/types';

const owner='0x'+'ab'.repeat(20);
const base=():QueryRun=>({id:'synthetic-publication-packet',createdAt:'2026-11-13T00:00:00.000Z',question:'Question "unicode đ"',answer:'Answer',engine:'heuristic',budget:1,totalSpent:0.1,totalToCreators:0.05,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline'});
function compare(run:QueryRun){
 const db=new DatabaseSync(':memory:');try{
  installSqliteApplicationSchema(db);writeSqliteQueryRun(db,run,false);
  const packet=JSON.parse(capturePublicationSourcePacket(run).wire),row=db.prepare('SELECT * FROM query_runs WHERE id=?').get(run.id)!;
  expect(Buffer.from(packet.originalHex,'hex').toString()).toBe(row.data);
  expect(packet.history).toEqual(sqliteOriginalHistoryProjection(db,run.id));
  const {questionHex:sqlQuestionHex,...ownership}=sqliteOwnershipHistoryProjection(db,run.id);expect(packet.ownership).toEqual(ownership);expect(sqlQuestionHex).toBe(db.prepare("SELECT lower(hex(CAST(json_extract(data,'$.question') AS BLOB))) h FROM query_runs WHERE id=?").get(run.id)!.h);
  // SQLite serializes REAL metadata as e.g. 1.0e-06; Node uses 0.000001.
  // Compare every metadata value, while the original above remains byte-exact.
  const semantic=(p:unknown):unknown=>JSON.parse(JSON.stringify(p),(key,value)=>{if(key==='answerHex')return undefined;if(key==='scalarCells'){const {question,...rest}=value;return rest;}if(key==='ownership'){const {questionHex,...rest}=value;return rest;}return key==='learningFields'&&typeof value==='string'?JSON.parse(value):value;});
  expect(semantic(packet.privacy)).toEqual(semantic(sqlitePrivacyProjection(db,run.id)));
  for(const [key,value] of Object.entries(packet.row))expect(typeof row[key]==='string'&&(row[key] as string).includes('\0')?JSON.parse(value as string):value,key).toEqual(row[key]);
 }finally{db.close();}
}
describe('pure native publication packet vs current SQLite record mapping',()=>{
 it.each(['question','answer','retainedOriginal'] as const)('retains a complete4M original with a large %s inside existing packet caps',field=>{
  const input={...base(),[field]:''},small=JSON.parse(capturePostgresPublication(input).wire),overhead=Buffer.from(small.originalHex,'hex').length;
  Object.assign(input,{[field]:'x'.repeat(4000000-overhead)});const captured=capturePostgresPublication(input),packet=JSON.parse(captured.wire);
  expect(Buffer.from(packet.originalHex,'hex')).toHaveLength(4000000);
  expect(Buffer.byteLength(captured.wire)).toBeLessThanOrEqual(33554432);
  const {row,originalHex,publication,...projection}=packet;void publication;
  expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(16777216);
  expect(Buffer.byteLength(JSON.stringify(publicationScalarCells(input).metadata))).toBeLessThanOrEqual(8388608);
  expect(row).not.toHaveProperty('question');expect(row).not.toHaveProperty('answer');
  expect(packet.ownership).not.toHaveProperty('questionHex');expect(packet.privacy).not.toHaveProperty('answerHex');expect(packet.privacy.scalarCells).not.toHaveProperty('question');
  const db=new DatabaseSync(':memory:');try{installSqliteApplicationSchema(db);writeSqliteQueryRun(db,input,false);expect(db.prepare('SELECT data FROM query_runs').get()?.data).toBe(Buffer.from(originalHex,'hex').toString());}finally{db.close();}
  expect(()=>capturePostgresPublication({...input,[field]:'x'.repeat(4000001-overhead)})).toThrow();
 });
 it('refuses a complete original collection beyond32MiB rather than truncating it',()=>{
  const wire=JSON.stringify({...base(),retainedOriginal:'x'.repeat(3900000)}),hex=Buffer.from(wire).toString('hex'),db=new DatabaseSync(':memory:');
  try{db.exec('CREATE TABLE q(data TEXT)');for(let i=0;i<5;i++)db.prepare('INSERT INTO q VALUES(?)').run(wire);
   const rows=db.prepare('SELECT lower(hex(CAST(data AS BLOB))) nativeOriginalHex FROM q').all();expect(rows).toHaveLength(5);expect(rows[0].nativeOriginalHex).toBe(hex);
   expect(()=>decodePublicationOriginalRead('list_recent_queries',rows)).toThrow();
  }finally{db.close();}
 });
 it('retains observed legacy scalar mismatches and raw nullness without inventing a QueryRun',()=>{
  const db=new DatabaseSync(':memory:');try{installSqliteApplicationSchema(db);const original=JSON.stringify({asker:null,question:123,unknown:'private\0\ud800'});
   db.prepare('INSERT INTO query_runs(id,created_at,question,answer,engine,asker,data) VALUES(?,?,?,?,?,?,?)').run('legacy-scalar','2026-01-01T00:00:00.000Z','observed\0question','PRIVATE_BODY',null,owner,original);
   const captured=sqlitePublicationScalarProjection(db,'legacy-scalar');expect(captured.scalarCells.question).toEqual({rawKind:'number',boundHex:Buffer.from('observed\0question').toString('hex')});
   expect(captured.scalarCells.id.rawKind).toBe('missing');expect(captured.scalarCells.asker.rawHex).toBeNull();expect(captured.scalarCells.asker.boundHex).toBe(Buffer.from(owner).toString('hex'));
   expect(captured.scalarCells.engine.boundHex).toBeNull();expect(JSON.stringify(captured.scalarCells)).not.toContain('PRIVATE_BODY');expect(captured.answerHex).toBe(Buffer.from('PRIVATE_BODY').toString('hex'));
   expect(db.prepare('SELECT data FROM query_runs').get()?.data).toBe(original);
  }finally{db.close();}
 });
 it('preserves exact new original, anonymous eligibility and all private derivatives',()=>compare(base()));
 it('preserves recorded ownership, Unicode, unknown escaped bytes and scalar mapping',()=>compare({...base(),asker:owner.toUpperCase().replace('0X','0x'),parentId:'parent',origin:'mcp',durationMs:12,paymentAttempts:0,settledPayments:0,uninterpreted:'\0\ud800'} as QueryRun));
 it('captures before caller mutation and validates publication intent',()=>{const run=base(),packet=capturePostgresPublication(run,{visibility:'private'});run.question='Changed';const captured=JSON.parse(packet.wire);expect(JSON.parse(Buffer.from(captured.originalHex,'hex').toString()).question).toBe('Question "unicode đ"');expect(captured.publication).toEqual({visibility:'private'});expect(()=>capturePostgresPublication(base(),{visibility:'bad'} as never)).toThrow();});
 it('matches numeric counters and nested citation, learning and usage metadata',()=>compare({...base(),budget:0.123456,totalSpent:0.012345,totalToCreators:0.000001,citations:[{marker:'S1',sourceId:'source',itemId:'item',sourceName:'Publisher',sourceKind:'public-reference',itemTitle:'Document',itemUrl:'https://example.test/doc',weight:1,reward:0.000001,rationale:'Fixture only',contentReceipt:{bodyHash:'ab'.repeat(32)},uninterpreted:'\0\ud800'}],decisions:[{sourceId:'source',action:'SKIP',reason:'Fixture only'}],sourceLearning:{extra:[1,true,'x']},usage:{extra:{x:1}}} as unknown as QueryRun));
 it('retains JSON.stringify economics cells independently of scalar normalization',()=>compare({...base(),llmUsage:[{engine:'llm:fixture',model:'model\0\ud800',inputTokens:1,outputTokens:2}],llmCalls:[{uninterpreted:'\0\udc00'}]} as unknown as QueryRun));
 it.each([null,false,0,1,'',[],{}])('keeps original fulfillment truthiness for %j',originalFulfillment=>compare({...base(),originalFulfillment} as unknown as QueryRun));
 it.each(['\0','\ud800','\udc00','\u0130'])('pure DTO matches genuine Source binding and metadata for %j while writer admission stays gated',text=>compare({...base(),question:'q'+text,answer:'PRIVATE_BODY'+text,engine:'engine'+text,asker:'owner'+text,mcpClient:('client'+text) as never}));
 it('refuses private IDs and scalar bytes PostgreSQL cannot represent before submission',()=>{expect(()=>capturePostgresPublication({...base(),id:'prv_example'})).toThrow();expect(()=>capturePostgresPublication({...base(),answer:'bad\0answer'})).toThrow();expect(()=>capturePostgresPublication({...base(),question:'bad\ud800'})).toThrow();});
});
