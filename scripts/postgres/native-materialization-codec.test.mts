import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { nativeMaterializationCell as cell,nativeMaterializationQueryCell as queryCell,nativeMaterializationValueKey as key } from './native-materialization-codec.mts';
import { snapshotRows,snapshotTables } from './typed-snapshot.mts';
import {nativeMaterializationProfile} from '../../lib/db/postgres/runtime-profile';
const text=(s:string)=>['text',Buffer.from(s).toString('hex')] as const;
it('does not turn explicit current DATA selection into an unsafe scalar codec exception',()=>{
 expect(nativeMaterializationProfile('development-current510-data-only').catalogSha256).not.toBe(nativeMaterializationProfile().catalogSha256);
 for(const type of ['text','jsonb'] as const)expect(()=>cell(text('Source\0original'),type)).toThrow();
 expect(queryCell(text('Source\0original'),'text','question')).toBe(JSON.stringify('Source\0original'));
});
it.each([false,true])('preserves actual Source leading BOM bytes without repairing generic TEXT (NUL=%s)',nul=>{
 const db=new DatabaseSync(':memory:'),value='\ufeffSource café'+(nul?'\0retained':'');try{
  db.exec('CREATE TABLE source_cells(value TEXT)');db.prepare('INSERT INTO source_cells VALUES(?)').run(value);db.exec('BEGIN');
  const original=[...snapshotRows(db,snapshotTables(db)[0])][0][0];
  expect(original).toEqual(text(value));expect(original[1]?.startsWith('efbbbf')).toBe(true);
  if(nul)expect(()=>cell(original,'text')).toThrow();
  else{
   const result=cell(original,'text');expect(result).toBe(value);
   expect(Buffer.from(result!).toString('hex')).toBe(original[1]);
   expect(key('text',result)).not.toBe(key('text',value.slice(1)));
  }
  expect(original).toEqual(text(value));
 }finally{db.close();}
});
it.each(['question','answer','asker'] as const)('preserves Source BOM and independent NUL shadow for %s',column=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE query_runs(question TEXT,answer TEXT,asker TEXT)');
  const values=['\ufeffSource café','\ufeffSource café\0retained'];
  for(const value of values)db.prepare('INSERT INTO query_runs VALUES(?,?,?)').run(value,value,value);
  db.exec('BEGIN');const table=snapshotTables(db)[0],rows=[...snapshotRows(db,table)],index=table.columns.indexOf(column);
  for(let i=0;i<values.length;i++){
   const original=rows[i][index],value=values[i],shadow=queryCell(original,'text',column);
   expect(original).toEqual(text(value));expect(shadow).toBe(i===0?value:JSON.stringify(value));
   const decoded=i===0?shadow:JSON.parse(shadow!);
   expect(Buffer.from(decoded!).toString('hex')).toBe(original[1]);
   expect(original[1]?.startsWith('efbbbf')).toBe(true);
   if(i===1){expect(shadow!.includes('\0')).toBe(false);expect(()=>cell(original,'text')).toThrow();}
  }
 }finally{db.close();}
});
it('keeps invalid UTF-8, BLOB, ID/date and BOM-prefixed JSON refusals',()=>{
 for(const hex of ['efbbbfff','efbbbfeda080','efbbbfc0af']){
  const invalid=['text',hex] as const;expect(()=>cell(invalid,'text')).toThrow();
  for(const column of ['question','answer','asker'])expect(()=>queryCell(invalid,'text',column)).toThrow();
 }
 for(const column of ['question','answer','asker'])expect(()=>queryCell(['blob','efbbbf'],'text',column)).toThrow();
 expect(()=>queryCell(text('\ufeff2026-11-14T00:00:00.000Z'),'timestamp with time zone','created_at')).toThrow();
 expect(()=>queryCell(text('\ufeffaaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),'keryx_storage.native_uuid_text','id')).toThrow();
 for(const column of ['id','created_at'])expect(()=>queryCell(text('\ufeffretained\0text'),'text',column)).toThrow();
 for(const type of ['json','jsonb'] as const)expect(()=>cell(text('\ufeff{"retained":true}'),type)).toThrow();
});
it('uses bounded Source shadows only for declared QueryRun scalar columns',()=>{
 const original=text('retained\0text');
 expect(()=>cell(original,'text')).toThrow();
 expect(queryCell(original,'text','question')).toBe(JSON.stringify('retained\0text'));
 expect(queryCell(text('ordinary'),'text','answer')).toBe('ordinary');
 expect(queryCell(['null'],'text','answer')).toBeNull();
 for(const column of ['id','created_at','data','unrecognized'])expect(()=>queryCell(original,'text',column)).toThrow();
 expect(original).toEqual(text('retained\0text'));
});
it('retains full int64 and distinguishes SQL NULL, JSON null and original JSON bytes',()=>{
 expect(cell(['integer','9223372036854775807'],'bigint')).toBe('9223372036854775807');
 expect(key('numeric','9223372036854775807.000')).toBe(key('numeric','9223372036854775807'));
 expect(key('numeric','9223372036854775806')).not.toBe(key('numeric','9223372036854775807'));
 expect(key('jsonb',null)).not.toBe(key('jsonb','null'));
 const original=' {"b":1,"a":"\\u0000\\ud800"} ';
 expect(cell(text(original),'json')).toBe(original);expect(key('json',original)).not.toBe(key('json',original.trim()));
 expect(()=>cell(text(original),'jsonb')).toThrow();
});
it('compares JSONB semantically while preserving decimal value and IEEE double bits',()=>{
 expect(key('jsonb','{"b":1,"a":2}')).toBe(key('jsonb','{ "a":2,"b":1 }'));
 expect(key('numeric','0.0000001')).toBe(key('numeric','1e-7'));
 expect(key('numeric','0.30000000000000004')).not.toBe(key('numeric','0.3'));
 const bytes=Buffer.alloc(8);bytes.writeDoubleBE(-0);expect(cell(['real',bytes.toString('hex')],'double precision')).toBe('-0');
 expect(key('double precision','-0')).not.toBe(key('double precision','0'));
});
it('refuses coercions and date normalization that could silently change retained values',()=>{
 expect(()=>cell(['integer','2'],'boolean')).toThrow();expect(()=>cell(text('1'),'integer')).toThrow();
 expect(()=>cell(['integer','32768'],'smallint')).toThrow();expect(()=>cell(['blob','00'],'text')).toThrow();
 expect(()=>cell(text('2026-11-14T00:00:00.000+00:00'),'timestamp with time zone')).toThrow();
 expect(()=>cell(text('2026-02-30'),'date')).toThrow();expect(()=>cell(text('private\0text'),'text')).toThrow();
});
it('refuses duplicate JSONB keys where actual SQLite and JS choose different values',()=>{
 const db=new DatabaseSync(':memory:');try{
  const wire='{"authorization":{"network":1,"network":2}}';
  expect(db.prepare("SELECT json_extract(?,'$.authorization.network') n").get(wire)!.n).toBe(1);expect(JSON.parse(wire).authorization.network).toBe(2);
  expect(()=>cell(text(wire),'jsonb')).toThrow();expect(()=>cell(text('{"a":1,"\\u0061":2}'),'jsonb')).toThrow();
  expect(cell(text('{"a":{"x":1},"b":{"x":2}}'),'jsonb')).toBe('{"a":{"x":1},"b":{"x":2}}');
  expect(cell(text(wire),'json')).toBe(wire);
 }finally{db.close();}
});
it('orders actual SQLite source rows by validated compound keys without changing default iteration',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE example(a TEXT,b INTEGER,PRIMARY KEY(a,b));INSERT INTO example VALUES(\'a\',2),(\'A\',3),(\'a\',1);BEGIN');const table=snapshotTables(db)[0];
  expect([...snapshotRows(db,table,['a','b'])].map(r=>[Buffer.from(r[0][1] as string,'hex').toString(),r[1][1]])).toEqual([['A','3'],['a','1'],['a','2']]);
  expect(()=>[...snapshotRows(db,table,['absent'])]).toThrow();expect(()=>[...snapshotRows(db,table,['a','a'])]).toThrow();
 }finally{db.close();}
});
