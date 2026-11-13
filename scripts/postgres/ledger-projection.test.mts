import { expect,it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sqliteLedgerProjection } from './ledger-projection.mts';
import { ledgerOriginalMetadata } from '../../lib/db/postgres/ledger-metadata';
import { ledgerRun } from '../../lib/operator-ledger/test-fixture';
import { captureLedgerRun } from '../../lib/operator-ledger/capture';
const project=(raw:string,id=ledgerRun().id)=>{const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE query_runs(id TEXT,created_at TEXT,data TEXT)');db.prepare('INSERT INTO query_runs VALUES(?,?,?)').run(id,ledgerRun().createdAt,raw);return sqliteLedgerProjection(db,id);}finally{db.close();}};
it('retains detached financial metadata only, bound to exact original bytes',()=>{
 const run=ledgerRun(),p=project(JSON.stringify(run));expect(p).toMatchObject({valid:true,references:[{sourceId:'creator-one',itemId:null}]});expect(JSON.parse(p.snapshotWire!)).toEqual(captureLedgerRun(run));expect(JSON.stringify(p)).not.toMatch(/PRIVATE-|Not projected/);expect(p.sha256).not.toBe(project(JSON.stringify({...run,answer:'Changed'})).sha256);
});
it('uses parsed-last originals, preserving escaped content versions outside JSONB metadata',()=>{
 const run=ledgerRun();run.decisions[0].contentVersion='version\0\ud800';const wire=JSON.stringify(run),p=project(wire);expect(p.valid).toBe(true);expect(JSON.parse(p.snapshotWire!).references[0].contentVersion).toBe('version\0\ud800');expect(p.references).toEqual([{sourceId:'creator-one',itemId:null}]);
 const duplicate=wire.slice(0,-1)+',"origin":"private"}';expect(project(duplicate)).toMatchObject({valid:true,snapshotWire:null,references:[]});
});
it('distinguishes an excluded original from an invalid original that the selected reader refuses',()=>{
 const run=ledgerRun();expect(ledgerOriginalMetadata({...run,origin:'mcp'},run.id,run.createdAt)).toMatchObject({valid:true,snapshotWire:null});
 for(const raw of ['not-json',JSON.stringify({...run,id:'different'}),JSON.stringify({...run,createdAt:'2026-01-01T00:00:00.000Z'}),JSON.stringify({...run,decisions:[null]})])expect(project(raw)).toMatchObject({valid:false,snapshotWire:null,references:[]});
});
