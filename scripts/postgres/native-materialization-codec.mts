/** Explicit operational cell conversion. Typed SOURCE wire remains separately
 * retained; this codec grants no runtime or target-discovery authority. */
import { canonicalJson } from '../../lib/canonical-json';
import type { SnapshotValue } from './typed-snapshot.mts';
export const NATIVE_MATERIALIZATION_TYPES=Object.freeze(['text','numeric','json','jsonb','timestamp with time zone','date','smallint','integer','bigint','boolean','keryx_storage.sqlite_number','keryx_storage.native_uuid_text','double precision'] as const);
export type NativeMaterializationType=typeof NATIVE_MATERIALIZATION_TYPES[number];
const refuse=():never=>{throw Error('Native materialization cell refused');};
export function nativeMaterializationType(raw:unknown):NativeMaterializationType{
 if(typeof raw!=='string'||!(NATIVE_MATERIALIZATION_TYPES as readonly string[]).includes(raw))return refuse();return raw as NativeMaterializationType;
}
function text(cell:SnapshotValue):string{
 if(cell[0]!=='text'||cell[1].length>8388608||cell[1].length%2||/[^a-f0-9]/.test(cell[1]))return refuse();
 let value:string;try{value=new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(cell[1],'hex'));}catch{return refuse();}
 if(value.includes('\0'))return refuse();return value;
}
function number(cell:SnapshotValue):string{
 if(cell[0]==='integer'){
  if(!/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/.test(cell[1])||cell[1].length>20)return refuse();
  const n=BigInt(cell[1]);if(n<BigInt('-9223372036854775808')||n>BigInt('9223372036854775807'))return refuse();return cell[1];
 }
 if(cell[0]!=='real'||!/^[a-f0-9]{16}$/.test(cell[1]))return refuse();const n=Buffer.from(cell[1],'hex').readDoubleBE();if(!Number.isFinite(n))return refuse();return Object.is(n,-0)?'-0':n.toString();
}
function unicode(value:unknown):boolean{
 if(typeof value==='string'){
  for(let i=0;i<value.length;i++){const c=value.charCodeAt(i);if(c===0)return false;if(c>=0xd800&&c<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))return false;}else if(c>=0xdc00&&c<=0xdfff)return false;}return true;
 }
 if(typeof value==='number')return Number.isFinite(value);
 return Array.isArray(value)?value.every(unicode):value!==null&&typeof value==='object'?Object.entries(value).every(([k,v])=>unicode(k)&&unicode(v)):true;
}
/** Decimal value equality, without passing int64 or PostgreSQL numeric through
 * a JS Number. This does not replace the retained SQLite storage class/bits. */
function decimal(value:string):string{
 if(value.length>2048)return refuse();const m=/^(-?)([0-9]+)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(value);if(!m)return refuse();
 const exponent=Number(m[4]??0)-(m[3]?.length??0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>16384)return refuse();
 let digits=(m[2]+(m[3]??'')).replace(/^0+/,'');if(!digits)return '0';let e=exponent;
 while(digits.endsWith('0')){digits=digits.slice(0,-1);e++;}return m[1]+digits+'e'+e;
}
export function nativeMaterializationCell(cell:SnapshotValue,type:NativeMaterializationType):string|null{
 nativeMaterializationType(type);if(cell[0]==='null')return null;
 if(['numeric','smallint','integer','bigint','keryx_storage.sqlite_number','double precision'].includes(type)){
  const value=number(cell);
  if(['smallint','integer','bigint'].includes(type)){
   let integer:bigint;try{integer=BigInt(value);}catch{return refuse();}
   const bits=BigInt(type==='smallint'?16:type==='integer'?32:64),bound=BigInt(1)<<(bits-BigInt(1));if(integer< -bound||integer>=bound)return refuse();
  }return value;
 }
 if(type==='boolean'){if(cell[0]!=='integer'||!['0','1'].includes(cell[1]))return refuse();return cell[1]==='1'?'true':'false';}
 const value=text(cell);
 if(type==='timestamp with time zone'){
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString()!==value)return refuse();
 }else if(type==='date'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)return refuse();
 }else if(type==='keryx_storage.native_uuid_text'){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))return refuse();
 }else if(type==='json'||type==='jsonb'){
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{return refuse();}if(type==='jsonb'&&!unicode(parsed))return refuse();
 }return value;
}
/** Compare the actual native text rendering with the independently decoded
 * SOURCE value. Original JSON/TEXT stays byte-exact; JSONB uses semantic value. */
export function nativeMaterializationValueKey(type:NativeMaterializationType,value:string|null):string{
 nativeMaterializationType(type);if(value===null)return 'null';if(typeof value!=='string')return refuse();
 if(type==='jsonb'){try{const parsed:unknown=JSON.parse(value);if(!unicode(parsed))return refuse();return 'jsonb:'+canonicalJson(parsed);}catch{return refuse();}}
 if(type==='double precision'){
  const n=Number(value);if(!Number.isFinite(n))return refuse();const bytes=Buffer.alloc(8);bytes.writeDoubleBE(n);return 'float64:'+bytes.toString('hex');
 }
 if(['numeric','smallint','integer','bigint','keryx_storage.sqlite_number'].includes(type))return 'number:'+decimal(value);
 return 'text:'+value;
}
