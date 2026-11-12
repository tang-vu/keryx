import { describe,it,expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { installSqliteApplicationSchema } from '../../lib/db/sqlite-application-schema';
import { writeSqliteQueryRun } from '../../lib/db/query-run-record';
import { capturePostgresPublication } from '../../lib/db/postgres/publication-packet';
import { sqliteOriginalHistoryProjection } from './run-history-projection.mts';
import { sqliteOwnershipHistoryProjection } from './ownership-history-projection.mts';
import { sqlitePrivacyProjection } from './privacy-projection.mts';
import type { QueryRun } from '../../lib/types';

const owner='0x'+'ab'.repeat(20);
const base=():QueryRun=>({id:'synthetic-publication-packet',createdAt:'2026-11-13T00:00:00.000Z',question:'Question "unicode đ"',answer:'Answer',engine:'heuristic',budget:1,totalSpent:0.1,totalToCreators:0.05,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:'offline'});
function compare(run:QueryRun){
 const db=new DatabaseSync(':memory:');try{
  installSqliteApplicationSchema(db);writeSqliteQueryRun(db,run,false);
  const packet=JSON.parse(capturePostgresPublication(run).wire),row=db.prepare('SELECT * FROM query_runs WHERE id=?').get(run.id)!;
  expect(Buffer.from(packet.originalHex,'hex').toString()).toBe(row.data);
  expect(packet.history).toEqual(sqliteOriginalHistoryProjection(db,run.id));
  expect(packet.ownership).toEqual(sqliteOwnershipHistoryProjection(db,run.id));
  // SQLite serializes REAL metadata as e.g. 1.0e-06; Node uses 0.000001.
  // Compare every metadata value, while the original above remains byte-exact.
  const semantic=(p:unknown):unknown=>JSON.parse(JSON.stringify(p),(key,value)=>key==='learningFields'&&typeof value==='string'?JSON.parse(value):value);
  expect(semantic(packet.privacy)).toEqual(semantic(sqlitePrivacyProjection(db,run.id)));
  for(const [key,value] of Object.entries(packet.row))expect(key==='economics_data'&&value!==null?JSON.stringify(value):value,key).toEqual(row[key]);
 }finally{db.close();}
}
describe('pure native publication packet vs current SQLite record mapping',()=>{
 it('preserves exact new original, anonymous eligibility and all private derivatives',()=>compare(base()));
 it('preserves recorded ownership, Unicode, unknown escaped bytes and scalar mapping',()=>compare({...base(),asker:owner.toUpperCase().replace('0X','0x'),parentId:'parent',origin:'mcp',durationMs:12,paymentAttempts:0,settledPayments:0,uninterpreted:'\0\ud800'} as QueryRun));
 it('captures before caller mutation and validates publication intent',()=>{const run=base(),packet=capturePostgresPublication(run,{visibility:'private'});run.question='Changed';const captured=JSON.parse(packet.wire);expect(captured.row.question).toBe('Question "unicode đ"');expect(captured.publication).toEqual({visibility:'private'});expect(()=>capturePostgresPublication(base(),{visibility:'bad'} as never)).toThrow();});
 it('matches numeric counters and nested citation, learning and usage metadata',()=>compare({...base(),budget:0.123456,totalSpent:0.012345,totalToCreators:0.000001,citations:[{marker:'S1',sourceId:'source',itemId:'item',sourceName:'Publisher',sourceKind:'public-reference',itemTitle:'Document',itemUrl:'https://example.test/doc',weight:1,reward:0.000001,rationale:'Fixture only',contentReceipt:{bodyHash:'ab'.repeat(32)},uninterpreted:'\0\ud800'}],decisions:[{sourceId:'source',action:'SKIP',reason:'Fixture only'}],sourceLearning:{extra:[1,true,'x']},usage:{extra:{x:1}}} as unknown as QueryRun));
 it.each([null,false,0,1,'',[],{}])('keeps original fulfillment truthiness for %j',originalFulfillment=>compare({...base(),originalFulfillment} as unknown as QueryRun));
 it('refuses private IDs and scalar bytes PostgreSQL cannot represent before submission',()=>{expect(()=>capturePostgresPublication({...base(),id:'prv_example'})).toThrow();expect(()=>capturePostgresPublication({...base(),answer:'bad\0answer'})).toThrow();expect(()=>capturePostgresPublication({...base(),question:'bad\ud800'})).toThrow();});
});
