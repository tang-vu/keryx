/** Synthetic bounded native history compared with the current SQLite reader. */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
import { createSqlitePersonalHistory } from '../../lib/db/personal-history-sqlite';
import { HistoryError,type HistoryFilters,type HistoryPosition } from '../../lib/history/personal-history';
import { createPostgresUserDomainTransport,type PostgresUserDomainTransport } from '../../lib/db/postgres/user-domain-transport';
import type { PostgresConnectionOptions } from '../../lib/db/postgres/connection';
import type { StorageIdentity } from '../../lib/db/storage-identity';
import { heldHistoryProjectionSql,sqliteOriginalHistoryProjection } from './run-history-projection.mts';
export async function qualifyPersonalHistory(input:{transport:PostgresUserDomainTransport;options:PostgresConnectionOptions;identity:StorageIdentity;digest:string;ownerSql:(sql:string)=>string;originalProjection?:boolean}){
 const db=new DatabaseSync(':memory:'),native=input.transport.personalHistory,owner='0x'+'e7'.repeat(20),other='0x'+'f8'.repeat(20),stamp='2026-01-02T03:04:05.000Z',later='2026-01-02T03:04:06.000Z';let vectors=0;
 const q=(s:string)=>"'"+s.replaceAll("'","''")+"'",pg=(s:string)=>input.ownerSql("BEGIN;UPDATE keryx_storage.control SET mode='held';"+s+"UPDATE keryx_storage.control SET mode='active';COMMIT;");
 const unavailable=(e:unknown)=>e instanceof HistoryError&&e.code==='history_unavailable';
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');const sqlite=createSqlitePersonalHistory(db);
  const compare=async(filters:HistoryFilters={},take=51,upper?:HistoryPosition,before?:HistoryPosition)=>{const query={filters,take,upper,before},rows=await native.list(owner.toUpperCase().replace('0X','0x'),query);assert.deepEqual(rows,await sqlite.list(owner,query));assert(!JSON.stringify(rows).includes('PRIVATE_ANSWER_MARKER'));vectors++;return rows;};await compare();
  const values:string[]=[],projections:string[]=[];
  for(let i=0;i<60;i++){
   const id='synthetic-history-'+String(i).padStart(2,'0'),created=i<30?stamp:later,question=i%3?'Topic '+i:'Literal _% '+i,asker=i===59?other:owner;
   const data={asker,askerFunded:i%2===0,provenance:i%4?{version:1,surface:i%2?'web':'api',ownershipMethod:'session'}:{version:1,surface:'web',ownershipMethod:'session',extra:'untrusted'},answer:'PRIVATE_ANSWER_MARKER'+(i<3?'x'.repeat(1024*1024):''),privateFulfillment:{secret:'PRIVATE_ANSWER_MARKER'}};
   const parent=i===3?'p'.repeat(1024):i%2?'parent':null;
   db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data,asker,total_spent,total_to_creators,payment_mode,parent_id) VALUES(?,?,?,0,?,?,?,?,?,?)').run(id,created,question,JSON.stringify(data),asker,i/1000000,i/2000000,i%2?'real':'offline',parent);
   values.push(`(${q(id)},${q(created)},${q(question)},0,${q(JSON.stringify(data))}::json,${q(asker)},${i/1000000},${i/2000000},${q(i%2?'real':'offline')},${parent===null?'NULL':q(parent)})`);
   if(input.originalProjection)projections.push(heldHistoryProjectionSql(id,sqliteOriginalHistoryProjection(db,id)));
  }
  pg('INSERT INTO public.query_runs(id,created_at,question,budget,data,asker,total_spent,total_to_creators,payment_mode,parent_id) VALUES'+values.join(',')+';'+projections.join('\n'));
  const first=await compare({},17),position=(row:typeof first[number])=>({id:row.id,createdAt:row.createdAt});assert.equal(first.length,17);
  const second=await compare({},17,position(first[0]),position(first.at(-1)!));assert.equal(new Set([...first,...second].map(r=>r.id)).size,34);
  await compare({search:'_%'});await compare({surface:'web'});await compare({surface:'unknown'});await compare({funding:'browser-recorded'});await compare({funding:'other-or-unknown'});await compare({from:stamp,to:stamp});await compare({search:'Topic',surface:'api',from:stamp,to:later},1);
  const all=await compare({},51);assert.equal(all.length,51);assert(Buffer.byteLength(JSON.stringify(all))<65536);vectors++;
  const id='synthetic-history-00',paymentValues:string[]=[];
  for(let i=0;i<205;i++){
   const pid='synthetic-history-payment-'+String(i).padStart(3,'0'),phase=i===0?'prepared':i===1?'cancelled_unexposed':null,kind=i%2?'fetch':'citation';
   db.prepare('INSERT INTO payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,created_at,authorization_phase) VALUES(?,?,?,?,?,?,?,0.000001,?,NULL,0,?,?,?)').run(pid,id,kind,'synthetic-source','Synthetic',owner,other,input.identity.network,'pending',stamp,phase);
   paymentValues.push(`(${q(pid)},${q(id)},${q(kind)},'synthetic-source','Synthetic',${q(owner)},${q(other)},.000001,${q(input.identity.network)},NULL,false,'pending',${q(stamp)},${phase===null?'NULL':q(phase)})`);
  }
  pg('INSERT INTO public.payment_events(id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,created_at,authorization_phase) VALUES'+paymentValues.join(',')+';');
  for(const take of [1,17,201]){const receipts=await native.receipts!(id,take);assert.deepEqual(receipts,await sqlite.receipts!(id,take));assert.equal(receipts.length,take);assert(!receipts.some(r=>r.id.endsWith('000')||r.id.endsWith('001')));vectors++;}
  await assert.rejects(native.list(owner,{filters:{},take:52}),unavailable);await assert.rejects(native.receipts!(id,202),unavailable);vectors++;
  const malformed='synthetic-history-malformed',poison={asker:other};db.prepare('INSERT INTO query_runs(id,created_at,question,budget,data,asker) VALUES(?,?,?,0,?,?)').run(malformed,stamp,'isolation-poison',JSON.stringify(poison),owner);pg(`INSERT INTO public.query_runs(id,created_at,question,budget,data,asker) VALUES(${q(malformed)},${q(stamp)},'isolation-poison',0,${q(JSON.stringify(poison))},${q(owner)});`+(input.originalProjection?heldHistoryProjectionSql(malformed,sqliteOriginalHistoryProjection(db,malformed)):''));await assert.rejects(native.list(owner,{filters:{search:'isolation-poison'},take:1}),unavailable);await assert.rejects(sqlite.list(owner,{filters:{search:'isolation-poison'},take:1}),unavailable);vectors++;
  db.prepare('UPDATE query_runs SET question=?,data=? WHERE id=?').run('x'.repeat(50000),JSON.stringify({asker:owner}),malformed);pg(`UPDATE public.query_runs SET question=repeat('x',50000),data=${q(JSON.stringify({asker:owner}))}::json WHERE id=${q(malformed)};`+(input.originalProjection?heldHistoryProjectionSql(malformed,sqliteOriginalHistoryProjection(db,malformed)):''));await assert.rejects(native.list(owner,{filters:{search:'xxx'},take:1}),unavailable);await assert.rejects(sqlite.list(owner,{filters:{search:'xxx'},take:1}),unavailable);vectors++;
  const reader=createPostgresUserDomainTransport({...input.options,role:'keryx_reader'},input.identity,input.digest);try{assert.deepEqual(await reader.personalHistory.list(owner,{filters:{search:'_%'},take:10}),await native.list(owner,{filters:{search:'_%'},take:10}));assert.deepEqual(await reader.personalHistory.receipts!(id,17),await native.receipts!(id,17));vectors++;}finally{await reader.close();}await assert.rejects(reader.personalHistory.list(owner,{filters:{},take:1}),unavailable);vectors++;
  return {vectors,currentSqliteOracle:true,equalTimestampCursorPaging:true,literalSearchAndClosedFilters:true,recordedProvenanceOnly:true,exactOwnerAndRecordedOwner:true,summaryRows:59,largePrivateAnswersProjectedOut:true,unprojectedParentIdsNotFetched:true,boundedReceiptSentinel:201,unexposedReceiptsOmitted:true,rowAndInputBounds:true,actualReadonlyRole:true,terminalClose:true,productionData:false,paidOperations:0};
 }finally{db.close();pg("DELETE FROM public.payment_events WHERE id LIKE 'synthetic-history-%';DELETE FROM public.query_runs WHERE id LIKE 'synthetic-history-%';");}
}
