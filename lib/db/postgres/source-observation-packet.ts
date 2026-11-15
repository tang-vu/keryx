import {canonicalJson} from '../../canonical-json';
import type {EvidenceProvenanceLookup} from '../../research/evidence-provenance';
import {PostgresStorageUnavailable} from './connection';
export const SOURCE_EVIDENCE_WIRE_BYTES=1540096,SOURCE_EVIDENCE_INPUT_BYTES=1544192,SOURCE_EVIDENCE_RESULT_BYTES=2359296;
export type SourceVerificationInput={sourceId:string;walletAddress:string;feedUrl:string};
function fail():never{throw new PostgresStorageUnavailable();}
const scalar=(value:unknown,maximum:number)=>{if(typeof value!=='string'||value.length>maximum)fail();return Buffer.from(value as string,'utf8').toString('hex');};
export function captureEvidenceProvenanceBatch(lookup:EvidenceProvenanceLookup){
 if(!lookup||!Array.isArray(lookup.sourceIds)||!Array.isArray(lookup.itemIds)||lookup.sourceIds.length>500||lookup.itemIds.length>500)fail();
 const sourceIdsHex=lookup.sourceIds.map(value=>scalar(value,256)),itemIdsHex=lookup.itemIds.map(value=>scalar(value,256));
 const wire=canonicalJson({sourceIdsHex,itemIdsHex});if(Buffer.byteLength(wire)>SOURCE_EVIDENCE_WIRE_BYTES)fail();
 return Object.freeze({wire,sourceIdsHex:Object.freeze(sourceIdsHex),itemIdsHex:Object.freeze(itemIdsHex)});
}
const ownKeys=(raw:unknown,keys:string[]):raw is Record<string,unknown>=>Boolean(raw&&typeof raw==='object'&&!Array.isArray(raw)&&Object.keys(raw).length===keys.length&&keys.every(key=>Object.hasOwn(raw,key)));
function decoded(value:unknown):string{
 if(typeof value!=='string'||value.length>1536||value.length%2||/[^a-f0-9]/.test(value))fail();
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value as string,'hex'));if(text.length>256)fail();return text;
}
export function decodeEvidenceProvenanceBatch(raw:unknown,captured:ReturnType<typeof captureEvidenceProvenanceBatch>):readonly string[]{
 if(!ownKeys(raw,['format','sourceIdsHex','items'])||raw.format!=='keryx-native-source-evidence-v1'||!Array.isArray(raw.sourceIdsHex)||!Array.isArray(raw.items)||raw.sourceIdsHex.length+raw.items.length>1000||Buffer.byteLength(JSON.stringify(raw))>SOURCE_EVIDENCE_RESULT_BYTES)fail();
 const wantedSources=new Set(captured.sourceIdsHex),wantedItems=new Set(captured.itemIdsHex),seenSources=new Set<string>(),seenItems=new Set<string>(),flags:string[]=[];
 for(const value of raw.sourceIdsHex as unknown[]){const id=decoded(value);if(!wantedSources.has(value as string)||seenSources.has(value as string))fail();seenSources.add(value as string);flags.push('source:'+id);}
 for(const row of raw.items as unknown[]){if(!ownKeys(row,['idHex','sourceIdHex']))fail();const id=decoded(row.idHex),source=row.sourceIdHex===null?null:decoded(row.sourceIdHex);if(!wantedItems.has(row.idHex as string)||seenItems.has(row.idHex as string))fail();seenItems.add(row.idHex as string);flags.push('item:'+source+':'+id);}
 return Object.freeze(flags);
}
/** Exact Source validation and node:sqlite TEXT binding before any await. No
 * URL normalization, proof flag or caller-selected parser is introduced. */
export function captureSourceVerification(input:SourceVerificationInput){
 if(!input||typeof input.sourceId!=='string'||!input.sourceId||input.sourceId.length>256||typeof input.walletAddress!=='string'||!/^0x[0-9a-f]{40}$/i.test(input.walletAddress)||typeof input.feedUrl!=='string'||!input.feedUrl||input.feedUrl.length>4096)throw new Error('Invalid source verification identity');
 return canonicalJson({operation:'verify-if-unchanged',sourceIdHex:scalar(input.sourceId,256),walletHex:scalar(input.walletAddress.toLowerCase(),42),feedUrlHex:scalar(input.feedUrl,4096)});
}
