/** SOURCE inventory only. The caller supplies a separately built reference
 * descriptor, never an existing deployment to adopt as its own contract. */
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { installMainnetApplicationSchema } from '../../lib/db/mainnet-application-schema';
import { installNativeUserDomainSchema } from '../../lib/db/native-user-domain-schema';
const column=z.object({schema:z.string(),relation:z.string(),name:z.string(),type:z.string(),notNull:z.boolean()}).passthrough();
const descriptor=z.object({sections:z.object({relations:z.array(z.object({schema:z.string(),name:z.string(),kind:z.string()}).passthrough()),columns:z.array(column)}).passthrough()}).passthrough();
export function inspectApplicationTableParity(referenceCanonical:string){
 const source=descriptor.parse(JSON.parse(referenceCanonical)),db=new DatabaseSync(':memory:');
 try{
  db.exec('BEGIN');installMainnetApplicationSchema(db,{publicReferenceArchive:true});installNativeUserDomainSchema(db);db.exec('COMMIT');
  const tables=db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const nativeTables=new Set(source.sections.relations.filter(r=>r.schema==='public'&&r.kind==='r').map(r=>r.name));
  const sqlite=tables.map(table=>{
   const name=String(table.name);if(!/^[a-z][a-z0-9_]{0,62}$/.test(name))throw new Error('Unexpected source table identifier');
   const columns=db.prepare(`PRAGMA table_info("${name}")`).all().map(c=>({name:String(c.name),type:String(c.type),notNull:c.notnull===1,primaryKey:Number(c.pk),defaultValue:c.dflt_value}));
   return{name,columns,sql:String(table.sql)};
  });
  const sqliteNames=new Set(sqlite.map(t=>t.name));
  const sqliteIndexes=db.prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='index' AND sql IS NOT NULL ORDER BY name").all();
  const sqliteTriggers=db.prepare("SELECT name,tbl_name,sql FROM sqlite_schema WHERE type='trigger' ORDER BY name").all();
  const gaps=sqlite.map(t=>({name:t.name,tableMissing:!nativeTables.has(t.name),columns:t.columns.filter(c=>!source.sections.columns.some(n=>n.schema==='public'&&n.relation===t.name&&n.name===c.name))})).filter(t=>t.tableMissing||t.columns.length);
  return{format:'keryx-application-source-table-parity-v1',sourceOnly:true,sqliteTables:sqlite.length,sqliteColumns:sqlite.reduce((n,t)=>n+t.columns.length,0),postgresTables:nativeTables.size,
   missingTables:gaps.filter(t=>t.tableMissing).map(t=>t.name),missingColumns:gaps.filter(t=>!t.tableMissing),extraPostgresTables:[...nativeTables].filter(n=>!sqliteNames.has(n)),
   extraPostgresColumns:source.sections.columns.filter(c=>c.schema==='public'&&sqliteNames.has(c.relation)&&!sqlite.find(t=>t.name===c.relation)!.columns.some(n=>n.name===c.name)),sqliteSource:sqlite,
   sqliteIndexes,sqliteTriggers,nativeSourceColumns:source.sections.columns.filter(c=>c.schema==='public'&&nativeTables.has(c.relation)),applicationBackendSwitched:false};
 }finally{db.close();}
}
