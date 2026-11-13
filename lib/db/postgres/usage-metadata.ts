import { parseRunUsage } from '../../research/usage-provenance';
/** New publications already have a captured JSON.parse(JSON.stringify(...))
 * original. Retained originals use the held SQLite producer instead, preserving
 * SQLite's first matching top-level key when historical JSON has duplicates. */
export function publicationUsageMetadata(raw:Readonly<Record<string,unknown>>){
 const field=(name:'usage'|'provenance',limit:number)=>{
  const descriptor=Object.getOwnPropertyDescriptor(raw,name),value=descriptor&&'value' in descriptor?descriptor.value:undefined;
  if(!value||typeof value!=='object'||Array.isArray(value))return null;
  const wire=JSON.stringify(value);return Buffer.byteLength(wire)<=limit?wire:null;
 };
 return Object.freeze({usageWire:field('usage',2048),provenanceWire:field('provenance',1024)});
}
/** Body interpretation intentionally uses parsed JSON's last root key, as the
 * current run decoder does. Financial metadata keeps SQLite's first root key. */
export function usageBodyMetadata(raw:unknown,id:string,createdAt:unknown){
 const value=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:null;
 return Object.freeze({parsedUsage:parseRunUsage(value?.usage)??null,bodyIdentityValid:!!value&&value.id===id&&typeof createdAt==='string'&&value.createdAt===createdAt});
}
