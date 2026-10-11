import {afterAll,describe,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {SqliteAdapter} from './sqlite-adapter';
import {installSqliteApplicationSchema} from './sqlite-application-schema';
import {RUN_PRIVACY_SQL,createSqliteRunPrivacy} from './run-privacy-sqlite';
import {writeSqliteQueryRun} from './query-run-record';
import type {QueryRun} from '../types';
const connection=new DatabaseSync(':memory:');installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
const privacy=createSqliteRunPrivacy(connection);
const db=new SqliteAdapter(':memory:');Object.defineProperty(db,'runPrivacy',{value:privacy});
const save=(id:string,time='2026-09-01T00:00:00.000Z')=>{const run:QueryRun={id,createdAt:time,question:id,answer:id,engine:'fixture',budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]};writeSqliteQueryRun(connection,run,true);connection.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id=?").run(id);};
for(const id of ['a','b','c'])save(id);
afterAll(()=>{db.close();connection.close();});
describe('SQLite public query iterator',()=>{
  it('uses a bounded keyset and rechecks visibility before each publication',async()=>{
    const ids:string[]=[];for await(const run of db.iterateRecentQueries(3)){ids.push(run.id);if(ids.length===1){save('new','2026-09-02T00:00:00.000Z');connection.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id='b'").run();}}
    expect(ids).toEqual(['c','a']);const fresh:string[]=[];for await(const run of db.iterateRecentQueries(2))fresh.push(run.id);expect(fresh).toEqual(['new','c']);
  });
  it('fails closed on malformed public bodies and missing admission',async()=>{
    save('bad','2026-09-03T00:00:00.000Z');connection.prepare("UPDATE query_runs SET data='{' WHERE id='bad'").run();
    await expect((async()=>{for await(const run of db.iterateRecentQueries(3))void run;})()).rejects.toThrow();
    const absent=new SqliteAdapter(':memory:');try{expect(await absent.listRecentQueries(2)).toEqual([]);}finally{absent.close();}
  });
  it.each([0,-1,2501,1.5,NaN])('refuses invalid limit %s',async limit=>{await expect((async()=>{for await(const run of db.iterateRecentQueries(limit))void run;})()).rejects.toThrow('Invalid query scan limit');});
});
