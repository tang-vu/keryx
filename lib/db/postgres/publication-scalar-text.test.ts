import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {publicationScalarText,publicationSqliteJsonTextHex,publicationSqliteJsonTextValue} from './publication-scalar-text';
import {SQLITE_PUBLIC_QUESTION_FIELDS} from '../public-question-projection';
import {SQLITE_PUBLIC_SOURCE_HISTORY_FIELDS} from '../public-source-history-projection';
import {slimPrivacyHistoryFields} from './privacy-metadata';

const strings=['','plain','left\0right','\0suffix','prefix\0','a\ud800b','a\udc00b',
 'a\ud800\ud800b','a\ud800\udc00b','a\udc00\ud800b','\u00e9\0Z','e\u0301',
 '\\u0000','quote"slash\\\n\t','\u{1f512}'];
function sqlite<T>(read:(db:DatabaseSync)=>T):T{
 const db=new DatabaseSync(':memory:');try{return read(db);}finally{db.close();}
}

describe('publication Source scalar binding and JSON extraction',()=>{
 it.each(strings)('retains the exact scalar binding for %j',input=>sqlite(db=>{
  const originalWire=JSON.stringify({question:input});
  const actual=db.prepare(`SELECT ? AS value,lower(hex(CAST(? AS BLOB))) AS hex`).get(input,input)!;
  const captured=publicationScalarText(input);
  expect(captured.sourceHex).toBe(actual.hex);
  expect(JSON.parse(captured.sourceJsonWire)).toBe(actual.value);
  expect(captured.postgres).toEqual(input.includes('\0')?{kind:'unrepresentable'}:{kind:'text',value:actual.value});
  expect(JSON.stringify(captured)).not.toContain('\0');
  expect(JSON.stringify({question:input})).toBe(originalWire);
 }));

 it.each(strings)('retains the separate JSON-extraction bytes for %j',input=>sqlite(db=>{
  const wire=JSON.stringify({question:input});
  const actual=db.prepare(`SELECT json_extract(?,'$.question') AS value,
   lower(hex(CAST(json_extract(?,'$.question') AS BLOB))) AS hex`).get(wire,wire)!;
  expect(publicationSqliteJsonTextHex(input)).toBe(actual.hex);
  expect(publicationSqliteJsonTextValue(input)).toBe(actual.value);
 }));

 it('keeps NUL, surrogate replacement, and literal escape sequences distinct',()=>{
  expect(publicationScalarText('a\0b').sourceHex).toBe('610062');
  expect(publicationScalarText('a\ud800b').sourceHex).toBe('61efbfbd62');
  expect(publicationSqliteJsonTextHex('a\ud800b')).toBe('61eda08062');
  expect(publicationSqliteJsonTextValue('a\ud800b')).toBe('a\ufffd\ufffd\ufffdb');
  expect(publicationScalarText('\\u0000').sourceHex).not.toBe(publicationScalarText('\0').sourceHex);
  expect(()=>publicationScalarText(null as never)).toThrow();
  expect(()=>publicationSqliteJsonTextHex({} as never)).toThrow();
 });
});

describe('actual Source string operators used by question and metadata consumers',()=>{
 it('uses full bytes for equality, lower, and instr, but stops length/substr/LIKE at NUL',()=>sqlite(db=>{
  const row=db.prepare(`SELECT ?='a' AS equal_prefix,?=? AS equal_full,? IN ('a') AS in_prefix,
   length(?) AS length,substr(?,1,100) AS prefix,? LIKE '%B' AS suffix_like,
   instr(?,'B') AS suffix_instr,instr(?,char(0)) AS nul_instr,
   lower(hex(CAST(lower(?) AS BLOB))) AS lowered,? IS NULL AS absent`).get(
    'a\0B','a\0B','a\0B','a\0B','a\0B','a\0B','a\0B','a\0B','a\0B','a\0B','a\0B');
  expect(row).toEqual({equal_prefix:0,equal_full:1,in_prefix:0,length:1,prefix:'a',suffix_like:0,
   suffix_instr:3,nul_instr:2,lowered:'610062',absent:0});
 }));

 it.each(['right','\0right','left\0','', '\ufffd','\ud800','b'])('matches instr predicates independently for %j',needle=>sqlite(db=>{
  for(const question of ['left\0right','a\ud800b','a\udc00b','\u{1f512}b']){
   const wire=JSON.stringify({question}),row=db.prepare(`SELECT instr(?,?)>0 scalar,
    instr(json_extract(?,'$.question'),?)>0 extracted`).get(question,needle,wire,needle)!;
   const boundNeedle=Buffer.from(needle);
   expect(Buffer.from(publicationScalarText(question).sourceHex,'hex').includes(boundNeedle)).toBe(row.scalar===1);
   expect(Buffer.from(publicationSqliteJsonTextHex(question),'hex').includes(boundNeedle)).toBe(row.extracted===1);
  }
 }));

 it('preserves raw question-token metadata and excludes paid answer bytes',()=>sqlite(db=>{
  db.exec('CREATE TABLE query_runs(id TEXT,data TEXT)');
  const run={id:'synthetic-scalar-privacy',createdAt:'2026-11-15T00:00:00.000Z',question:'q\0\ud800tail',
   answer:'PAID_BODY_SECRET\0\udc00tail',engine:'engine\0\ud800',budget:1,totalSpent:0.1,totalToCreators:0,
   subClaims:[],decisions:[],citations:[],trace:[]};
  db.prepare('INSERT INTO query_runs VALUES(?,?)').run(run.id,JSON.stringify(run));
  const row=db.prepare(`SELECT ${SQLITE_PUBLIC_QUESTION_FIELDS} question,
   ${SQLITE_PUBLIC_SOURCE_HISTORY_FIELDS} history FROM query_runs q`).get()!;
  const question=JSON.parse(String(row.question)) as [string,string,unknown][];
  expect(question.find(([key])=>key==='question')?.[2]).toBe(run.question);
  expect(question.find(([key])=>key==='engine')?.[2]).toBe(run.engine);
  expect(question.find(([key])=>key==='answer')?.[2]).toBeNull();
  expect(String(row.question)).not.toContain('PAID_BODY_SECRET');
  const history=slimPrivacyHistoryFields(row.history);
  expect(history.fields).not.toContain('PAID_BODY_SECRET');
  expect(history.fields).not.toContain('tail');
  expect(JSON.parse(history.fields!).find(([key]:[string])=>key==='answer')[2]).toBe('present');
  expect(db.prepare('SELECT data FROM query_runs').get()?.data).toBe(JSON.stringify(run));
 }));
});
