import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { nativeMaterializationCell as cell,nativeMaterializationValueKey as key } from './native-materialization-codec.mts';
import { snapshotRows,snapshotTables } from './typed-snapshot.mts';
const text=(s:string)=>['text',Buffer.from(s).toString('hex')] as const;
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
it('orders actual SQLite source rows by validated compound keys without changing default iteration',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE example(a TEXT,b INTEGER,PRIMARY KEY(a,b));INSERT INTO example VALUES(\'a\',2),(\'A\',3),(\'a\',1);BEGIN');const table=snapshotTables(db)[0];
  expect([...snapshotRows(db,table,['a','b'])].map(r=>[Buffer.from(r[0][1] as string,'hex').toString(),r[1][1]])).toEqual([['A','3'],['a','1'],['a','2']]);
  expect(()=>[...snapshotRows(db,table,['absent'])]).toThrow();expect(()=>[...snapshotRows(db,table,['a','a'])]).toThrow();
 }finally{db.close();}
});
