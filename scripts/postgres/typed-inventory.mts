/** Metadata-only inventory shared by independently contained operator children. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { snapshotRows,snapshotRowWire,snapshotTables } from './typed-snapshot.mts';
export interface InventoryDiagnostic {stage:string;table:string|null;rows:number;wireBytes:number;started:number}
export function inventorySnapshot(db:DatabaseSync,deadline:number,diagnostic:InventoryDiagnostic,maxRows=5000000){
 diagnostic.stage='schema';const tables=snapshotTables(db),results=[];
 let totalRows=0,totalCells=0,totalWireBytes=0,totalRawBytes=0;
 for(const table of tables){
  diagnostic.stage='rows';diagnostic.table=table.name;
  const digest=createHash('sha256');let rows=0,maxRowWireBytes=0;
  const columns=table.columns.map(name=>({name,null:0,integer:0,real:0,text:0,blob:0,maxBytes:0,textNul:0,invalidUtf8:0,unsafeJsInteger:0}));
  for(const row of snapshotRows(db,table)){
   const wire=snapshotRowWire(row),bytes=Buffer.byteLength(wire);digest.update(wire).update('\n');rows++;totalRows++;totalCells+=row.length;totalWireBytes+=bytes;maxRowWireBytes=Math.max(maxRowWireBytes,bytes);
   diagnostic.rows=totalRows;diagnostic.wireBytes=totalWireBytes;
   if(performance.now()>=deadline){diagnostic.stage='deadline';throw new Error('bounded inventory deadline');}
   assert(totalRows<=maxRows,'Declared operator intake row bound');
   row.forEach((cell,i)=>{const c=columns[i],kind=cell[0];c[kind]++;
    if(kind==='integer'){const n=BigInt(cell[1]);if(n>BigInt(Number.MAX_SAFE_INTEGER)||n<BigInt(Number.MIN_SAFE_INTEGER))c.unsafeJsInteger++;}
    if(kind==='text'||kind==='blob'){
     const buffer=Buffer.from(cell[1],'hex');totalRawBytes+=buffer.length;c.maxBytes=Math.max(c.maxBytes,buffer.length);
     if(kind==='text'){if(buffer.includes(0))c.textNul++;try{new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{c.invalidUtf8++;}}
    }
   });
  }
  results.push({name:table.name,rows,digest:digest.digest('hex'),maxRowWireBytes,columns});
 }
 return {tables:results,totalRows,totalCells,totalWireBytes,totalRawTextBlobBytes:totalRawBytes};
}
