/** Catalog timer-phase regressions only. No PostgreSQL or runtime proof is installed. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Client } from 'pg';
import ts from 'typescript';
import { expect,it } from 'vitest';
import { exportNativePostgresSchemaContract } from './native-contract.mts';
import { compareFreshNativePublicTransaction,compareNativeSnapshotTransaction } from './materialize-native-snapshot.mts';

const sections=['database','schemas','relations','columns','constraints','indexes','triggers','functions','policies','defaults','roles','memberships','roleSettings','inheritance','sequenceOwnership','sequences','types','rules','collations','operations'];
const wire=JSON.stringify({format:'keryx-postgres17-runtime-contract-v1',major:17,sections:Object.fromEntries(sections.map(name=>[name,name==='functions'?[{name:'f',source:"select '?';\n"}]:[]]))});

it.each(['fresh','compare'] as const)('drains a real pending timer after the %s kernel reference export and preserves profile refusal',async mode=>{
 const before=exportNativePostgresSchemaContract(wire);let fired=false,sqlCalls=0;
 const pending=new Promise<void>(done=>setTimeout(()=>{fired=true;done();},0));
 const pg={query:async()=>{sqlCalls++;throw Error('No SQL is admitted for this unqualified descriptor');}} as unknown as Client;
 const db=new DatabaseSync(':memory:');try{
  db.exec('PRAGMA query_only=ON;BEGIN');
  const operation=mode==='fresh'?compareFreshNativePublicTransaction(pg,wire):compareNativeSnapshotTransaction(db,pg,pg,wire);
  await expect(operation).rejects.toThrow();expect(fired).toBe(true);expect(sqlCalls).toBe(0);
  const after=exportNativePostgresSchemaContract(wire);expect(after.canonicalJson).toBe(before.canonicalJson);expect(after.normalizedSha256).toBe(before.normalizedSha256);
  expect(after.sha256).toBe(createHash('sha256').update(wire).digest('hex'));expect(Object.isFrozen(after)).toBe(true);expect(Object.isFrozen(after.metadata)).toBe(true);
 }finally{await pending;db.close();}
});

it('keeps every synchronous export followed by an awaited Node timer phase, including fresh and final observations',()=>{
 const counts:Record<string,number>={};
 for(const name of ['server1-online-b0-intake.mts','materialize-native-snapshot.mts','materialize-native-projections.mts']){
  const text=readFileSync(new URL(name,import.meta.url),'utf8'),source=ts.createSourceFile(name,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  expect(source.statements.some(n=>ts.isImportDeclaration(n)&&n.moduleSpecifier.getText(source)==="'node:timers/promises'"&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)&&n.importClause.namedBindings.elements.some(e=>e.propertyName?.text==='setTimeout'&&e.name.text==='yieldTimers'))).toBe(true);
  let count=0;
  const visit=(node:ts.Node)=>{
   if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='exportNativePostgresSchemaContract'){
    count++;let statement:ts.Node=node;while(statement.parent&&!ts.isVariableStatement(statement))statement=statement.parent;
    expect(ts.isVariableStatement(statement)).toBe(true);const parent=statement.parent;expect(ts.isSourceFile(parent)||ts.isBlock(parent)).toBe(true);
    if(!ts.isSourceFile(parent)&&!ts.isBlock(parent))throw Error('Missing catalog statement block');
    const next=parent.statements[parent.statements.indexOf(statement as ts.Statement)+1];expect(next&&ts.isExpressionStatement(next)&&ts.isAwaitExpression(next.expression)).toBe(true);
    if(!next||!ts.isExpressionStatement(next)||!ts.isAwaitExpression(next.expression))throw Error('Missing timer phase');
    const call=next.expression.expression;expect(ts.isCallExpression(call)&&ts.isIdentifier(call.expression)&&call.expression.text==='yieldTimers'&&call.arguments.length===1&&call.arguments[0].getText(source)==='0').toBe(true);
   }ts.forEachChild(node,visit);
  };visit(source);counts[name]=count;
 }
 expect(counts).toEqual({'server1-online-b0-intake.mts':1,'materialize-native-snapshot.mts':5,'materialize-native-projections.mts':1});
});
