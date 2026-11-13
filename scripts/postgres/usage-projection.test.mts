import { afterEach,expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sqliteUsageProjection } from './usage-projection.mts';
import { publicationUsageMetadata } from '../../lib/db/postgres/usage-metadata';
const opened:DatabaseSync[]=[];afterEach(()=>{for(const db of opened.splice(0))db.close();});
function fixture(original:string){const db=new DatabaseSync(':memory:');opened.push(db);db.exec('CREATE TABLE query_runs(id TEXT PRIMARY KEY,data TEXT,created_at TEXT)');db.prepare('INSERT INTO query_runs VALUES(?,?,?)').run('usage-original',original,'2026-10-09T10:00:00.000Z');db.exec('BEGIN');return {db,project:()=>sqliteUsageProjection(db,'usage-original')};}
it('retains SQLite first top-level usage and provenance instead of last-key JSON.parse semantics',()=>{
 const original='{"usage":{"network":"eip155:5042"},"usage":{"network":"eip155:5042002"},"provenance":{"first":true},"provenance":{"last":true}}',p=fixture(original).project();expect(JSON.parse(p.usageWire!)).toEqual({network:'eip155:5042'});expect(JSON.parse(p.provenanceWire!)).toEqual({first:true});expect(JSON.parse(original).usage.network).toBe('eip155:5042002');
});
it('matches fresh captured publication metadata without parsing unrelated NUL/surrogate fields in PostgreSQL',()=>{
 for(const raw of [{usage:{network:'eip155:5042'},provenance:{source:'🌍'},unrelated:'\0\ud800'},{usage:{uninterpreted:'\0\ud800'},provenance:{},unrelated:{large:'x'.repeat(10000)}},{usage:null,provenance:[]},{usage:42,provenance:'unknown'},{}]){
  const original=JSON.stringify(raw),p=fixture(original).project();expect({usageWire:p.usageWire,provenanceWire:p.provenanceWire}).toEqual(publicationUsageMetadata(JSON.parse(original)));
 }
});
it('retains exact metadata byte ceilings and treats larger fields as unknown',()=>{
 for(const [key,limit] of [['usage',2048],['provenance',1024]] as const){const within={value:'x'.repeat(limit-12)},wire=JSON.stringify(within);expect(Buffer.byteLength(wire)).toBe(limit);expect(fixture(JSON.stringify({[key]:within})).project()[key==='usage'?'usageWire':'provenanceWire']).toBe(wire);expect(fixture(JSON.stringify({[key]:{value:within.value+'x'}})).project()[key==='usage'?'usageWire':'provenanceWire']).toBeNull();}
});
it('keeps malformed originals unknown and binds metadata to exact unchanged original bytes',()=>{
 const {db,project}=fixture('not-json'),before=project();expect(before.usageWire).toBeNull();expect(before.provenanceWire).toBeNull();db.prepare('UPDATE query_runs SET data=?').run('{"usage":{}}');expect(project().sha256).not.toBe(before.sha256);expect(()=>sqliteUsageProjection(db,'missing')).toThrow();
});
