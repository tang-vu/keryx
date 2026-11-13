import { validatePrivacyRun } from '../../run-privacy/contracts';
import { demoteSyntheticEvidence } from '../../research/evidence-provenance';
import { captureLedgerRun } from '../../operator-ledger/capture';
/** Exact parsed-original interpretation, with only public ledger fields retained.
 * Dynamic source/item provenance is read separately in the final native snapshot.
 * The wire is TEXT: a contentVersion may contain escaped NUL/surrogates that
 * PostgreSQL JSONB cannot represent. SQL sees closed reference IDs only. */
export function ledgerOriginalMetadata(raw:unknown,id:string,createdAt:unknown){
 try{
  const run=validatePrivacyRun(raw,id);if(run.createdAt!==createdAt)throw Error();
  const references=[...run.citations,...run.decisions,...(Array.isArray(run.evidence)?run.evidence:[])];
  const sourceIds=[...new Set(references.map(item=>item.sourceId))],itemIds=[...new Set(references.flatMap(item=>item.itemId?[item.itemId]:[]))];
  // Match the current SQLite metadata lookup's finite text bounds and native
  // scalar bindings, including numeric legacy references that capture excludes.
  for(const value of [...sourceIds,...itemIds])if(typeof value!=='string'&&typeof value!=='number'||typeof value==='string'&&value.length>256)throw Error();
  const snapshot=captureLedgerRun(demoteSyntheticEvidence(run)),wire=snapshot===null?null:JSON.stringify(snapshot);
  if(wire!==null&&Buffer.byteLength(wire)>2097152)throw Error();
  return Object.freeze({valid:true,snapshotWire:wire,references:snapshot?.references.map(row=>({sourceId:row.sourceId,itemId:row.itemId}))??[]});
 }catch{return Object.freeze({valid:false,snapshotWire:null,references:[]});}
}
