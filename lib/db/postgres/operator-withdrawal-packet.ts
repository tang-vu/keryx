import {createHash} from 'node:crypto';
import {canonicalJson} from '../../canonical-json';
import type {WithdrawalRecord} from '../../types';
import {operatorInventoryInputSchema} from '../../business-operator/inventory';
import {operatorInventorySchema,operatorPublicSnapshotSchema} from '../../business-operator/contracts';
import {summarizeNativeRecordedJobs,type NativeRecordedJobRow} from './recorded-job-summary';
import {PostgresStorageUnavailable} from './connection';
import {storageIdentityDigest,type StorageIdentity} from '../storage-identity';
export const OPERATOR_SOURCE_MAX_ROWS=1000,OPERATOR_SOURCE_BYTES=4194304;
function fail():never{throw new PostgresStorageUnavailable();}
export const sourceAsciiLower=(value:string)=>value.replace(/[A-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+32));
const hex=(value:string)=>Buffer.from(value,'utf8').toString('hex');
export function sourceCellHex(value:unknown):string|null{if(value===null||value===undefined)return null;if(typeof value!=='string')fail();return hex(value);}
export function sourceCellText(value:unknown):string|null{
 if(value===null)return null;if(typeof value!=='string'||value.length%2||/[^a-f0-9]/.test(value))fail();
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value,'hex'));}catch{return fail();}
}
export function captureWithdrawalSource(value:WithdrawalRecord){
 const w=structuredClone(value);
 if(!/^0x[a-fA-F0-9]{64}$/.test(w.txHash)||!/^0x[a-fA-F0-9]{40}$/.test(w.wallet)||!/^0x[a-fA-F0-9]{40}$/.test(w.recipient)
  ||!Number.isFinite(w.amountUsdc)||w.amountUsdc<=0||typeof w.network!=='string'||!w.network||typeof w.createdAt!=='string'||!Number.isFinite(Date.parse(w.createdAt))
  ||typeof w.label!=='string'||(w.sourceName!=null&&typeof w.sourceName!=='string'))throw new Error('Invalid withdrawal record');
 // This is an exact Source column packet, not a payment/chain attestation.
 // UTF-8 encoding is the existing node:sqlite scalar binding boundary; lone
 // surrogates become U+FFFD and embedded NUL remains a byte, never SQL NULL.
 const cells={tx_hash:w.txHash,created_at:hex(w.createdAt),label:hex(w.label),source_name:sourceCellHex(w.sourceName),wallet:w.wallet,recipient:w.recipient,amount_usdc:w.amountUsdc,network:hex(w.network)};
 const original=canonicalJson(cells),sha256=createHash('sha256').update(original).digest('hex');
 const wire=canonicalJson({cells,original,sha256,networkToken:JSON.stringify(w.network)});if(Buffer.byteLength(wire)>60000)fail();return Object.freeze({wire,cells:Object.freeze(cells),original,sha256});
}
/** Held Source intake only. The caller must supply the independently observed
 * eight Source columns; this never fills a missing original from a shadow. */
export function heldWithdrawalSourceFixture(raw:Readonly<Record<string,unknown>>,identity:StorageIdentity){
 const names=['tx_hash','created_at','label','source_name','wallet','recipient','amount_usdc','network'];
 if(Object.keys(raw).length!==8||names.some(name=>!Object.hasOwn(raw,name))||typeof raw.tx_hash!=='string'||!/^0x[0-9a-fA-F]{64}$/.test(raw.tx_hash)||typeof raw.wallet!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(raw.wallet)||typeof raw.recipient!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(raw.recipient)||raw.network!==identity.network||typeof raw.amount_usdc!=='number'||!Number.isFinite(raw.amount_usdc)||raw.amount_usdc<=0||[raw.created_at,raw.label,raw.source_name].some(v=>v!==null&&typeof v!=='string'))fail();
 const cells={tx_hash:raw.tx_hash,created_at:sourceCellHex(raw.created_at),label:sourceCellHex(raw.label),source_name:sourceCellHex(raw.source_name),wallet:raw.wallet,recipient:raw.recipient,amount_usdc:raw.amount_usdc,network:sourceCellHex(raw.network)},original=canonicalJson(cells);
 if(Buffer.byteLength(original)>30000)fail();const unprojected=['created_at','label','source_name','network'].filter(name=>typeof raw[name]==='string'&&(raw[name] as string).includes('\0'));
 const physical=Object.fromEntries(names.map(name=>[name,unprojected.includes(name)?null:raw[name]])),q=(value:string)=>"'"+value.replaceAll("'","''")+"'",value=(v:unknown)=>v===null?'NULL':typeof v==='number'?String(v):q(v as string);
 return Object.freeze({original,sha256:createHash('sha256').update(original).digest('hex'),cells,unprojected,
  physicalSql:`INSERT INTO public.withdrawals(${names.join(',')}) VALUES(${names.map(name=>value(physical[name])).join(',')});`,
  scalarSql:`INSERT INTO keryx_storage.withdrawal_source_originals(tx_hash,identity_digest,original,original_sha256,cells,native_projection,unprojected_fields) SELECT tx_hash,${q(storageIdentityDigest(identity))},${q(original)},${q(createHash('sha256').update(original).digest('hex'))},${q(original)}::jsonb,to_jsonb(w),ARRAY[${unprojected.map(q).join(',')}]::text[] FROM public.withdrawals w WHERE tx_hash=${q(raw.tx_hash)};`});
}
export function captureOperatorInventory(raw:unknown,network:string){const input=operatorInventoryInputSchema.parse(raw);if(input.network!==network)throw new Error('Operator inventory network mismatch');return Object.freeze({...input});}
export function captureOperatorPublic(nowMs:number){if(typeof nowMs!=='number'||!Number.isFinite(nowMs)||nowMs< -8640000000000000+86400000||nowMs>8640000000000000)fail();return Object.freeze({nowMs,since:new Date(nowMs-86400000).toISOString()});}
/** SQLite's date.c arithmetic, not Date.parse or PostgreSQL date coercion.
 * Dynamic now/subsec/subsecond forms have no portable captured Source clock and
 * explicitly refuses the complete observation instead of inventing a date. */
export function sourceJulianDay(raw:unknown):number|null{
 if(raw===null||raw===undefined)return null;let value=String(raw).split('\0')[0];
 if(/^(now|subsec|subsecond)$/i.test(value))fail();
 if(typeof raw==='number'||/^[\t\n\v\f\r ]*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[\t\n\v\f\r ]*$/.test(value)){
  const n=Number(value),ms=Math.floor(n*86400000+0.5);return Number.isFinite(n)&&n>=0&&n<5373484.5&&ms<=464269060799999?ms/86400000:null;
 }
 const m=/^(?:(-?\d{4})-(\d{2})-(\d{2})[\t\n\v\f\r T]*)?(?:(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?[\t\n\v\f\r ]*([Zz]|[+-]\d{2}:\d{2})?[\t\n\v\f\r ]*$/.exec(value);
 if(!m||(!m[1]&&!m[4])||(m[8]&&!m[4]))return null;
 let year=m[1]?Number(m[1]):2000,month=m[2]?Number(m[2]):1,day=m[3]?Number(m[3]):1;
 const hour=Number(m[4]??0),minute=Number(m[5]??0),second=Number(m[6]??0),fraction=Number(m[7]??0);
 if(month<1||month>12||day<1||day>31||hour>24||minute>59||second>59)return null;
 if(month<=2){year--;month+=12;}const a=Math.trunc(year/100),b=2-a+Math.trunc(a/4),x1=Math.trunc(36525*(year+4716)/100),x2=Math.trunc(306001*(month+1)/10000);
 let ms=(x1+x2+day+b-1524.5)*86400000+hour*3600000+minute*60000+Math.trunc((second+fraction)*1000+0.5);
 if(m[8]&&m[8].toUpperCase()!=='Z'){const h=Number(m[8].slice(1,3)),min=Number(m[8].slice(4));if(h>14||min>59)return null;ms-=(m[8][0]==='-'?-1:1)*(h*60+min)*60000;}
 return ms>=0&&ms<=464269060799999?ms/86400000:null;
}
/** SQLite JSON1 selects the first member and compares decoded labels through
 * their first NUL. JS properties have neither rule. Preserve both Source rules
 * only for JSON extraction; ordinary bound scalar properties stay distinct. */
export function sourceJsonFields(wire:string|null):{object:boolean;fields:Map<string,{value:unknown;token:string}>}{
 const fields=new Map<string,{value:unknown;token:string}>();if(wire===null)return {object:false,fields};
 let nesting=0,inString=false,escape=false;for(const c of wire){if(inString){if(escape)escape=false;else if(c==='\\')escape=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='['||c==='{'){if(++nesting>1000)return {object:false,fields};}else if(c===']'||c==='}')nesting--;}
 let root:unknown;try{root=JSON.parse(wire);}catch{return {object:false,fields};}if(root===null||typeof root!=='object'||Array.isArray(root))return {object:false,fields};
 let p=wire.indexOf('{')+1;const ws=()=>{while(/[\t\r\n ]/.test(wire[p]??'!'))p++;};
 const token=()=>{const start=p;let depth=0,quoted=false,escaped=false;while(p<wire.length){const c=wire[p];if(quoted){p++;if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;p++;continue;}if(c==='['||c==='{')depth++;if(c===']'||c==='}'){if(depth===0)break;depth--;}if(c===','&&depth===0)break;p++;}return wire.slice(start,p).trim();};
 ws();while(wire[p]!=='}'){const begin=p;p++;while(p<wire.length){if(wire[p]==='\\'){p+=2;continue;}if(wire[p++]==='"')break;}const key=(JSON.parse(wire.slice(begin,p)) as string).split('\0')[0];ws();p++;ws();const text=token();if(!fields.has(key))fields.set(key,{value:JSON.parse(text),token:text});ws();if(wire[p]!==',')break;p++;ws();}
 return {object:true,fields};
}
const sqliteNumber=(v:unknown):number|null=>{if(v===null||v===undefined)return null;if(typeof v==='number')return v;if(typeof v==='boolean')return Number(v);if(typeof v!=='string')return 0;const m=/^[\t\n\v\f\r ]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(v);return m?Number(m[1]):0;};
const sqliteMax=(a:unknown,b:unknown):unknown=>{if(b===null||b===undefined)return a;if(a===null||a===undefined)return b;if(typeof a==='string'&&typeof b!=='string')return a;if(typeof b==='string'&&typeof a!=='string')return b;if(typeof a==='string'&&typeof b==='string')return Buffer.compare(Buffer.from(a),Buffer.from(b))>=0?a:b;return Number(a)>=Number(b)?a:b;};
const jsonText=(v:unknown):unknown=>typeof v==='boolean'?Number(v):v&&typeof v==='object'?JSON.stringify(v):v;
const round=(n:number)=>n<0?-Math.floor(-n+0.5):Math.floor(n+0.5);
type InventoryRow={payee:string|null;budget:number|null;started:string|null;transaction:string|null;request:string|null};
type MonthlyRow={wire:string;used:number};
export function reduceOperatorInventory(raw:unknown,input:ReturnType<typeof captureOperatorInventory>){
 const r=raw as {format?:unknown;orders?:InventoryRow[];monthly?:MonthlyRow[]};
 if(!r||Object.keys(r).sort().join(',')!=='format,monthly,orders'||r.format!=='keryx-source-operator-inventory-v1'||!Array.isArray(r.orders)||!Array.isArray(r.monthly)||r.orders.length+r.monthly.length>OPERATOR_SOURCE_MAX_ROWS||Buffer.byteLength(JSON.stringify(raw))>OPERATOR_SOURCE_BYTES)fail();
 const now=new Date(input.nowMs).toISOString(),jd=sourceJulianDay(now)!,before=sourceJulianDay(new Date(input.nowMs-900000).toISOString())!;
 let queued=0,processing=0,review=0,invalid=0,queuedCap=0,unfinishedCap=0,prepaid=0,prepaidCap=0;let largest:unknown=0;
 for(const row of r.orders){
  if(!row||Object.keys(row).sort().join(',')!=='budget,payee,request,started,transaction'||['payee','request','started','transaction'].some(k=>row[k as keyof InventoryRow]!==null&&typeof row[k as keyof InventoryRow]!=='string')||(row.budget!==null&&typeof row.budget!=='number'))fail();
  const parsed=sourceJsonFields(row.request),network=jsonText(parsed.fields.get('network')?.value)??'eip155:5042002',start=sourceJulianDay(row.started),cap=row.budget===null?null:round(row.budget*1000000);if(cap!==null&&!Number.isSafeInteger(cap))fail();
  // SQL's NULL OR false remains NULL, so a nullable numeric operand alone is
  // not an invalid row; the explicit JSON/transaction gates are independent.
  if((row.payee!==null&&sourceAsciiLower(row.payee)!==input.payee)||!parsed.object||network!==input.network||(row.budget!==null&&(row.budget<=0||row.budget>1000000||row.budget!==cap!/1000000))||(row.started!==null&&(start===null||start>jd))||row.transaction===null||row.transaction.replace(/^ +| +$/g,'')==='')invalid++;
  if(row.started===null){queued++;queuedCap+=cap??0;largest=sqliteMax(largest,cap);}else{unfinishedCap+=cap??0;if(start!==null&&start>before)processing++;else review++;}
 }
 for(const row of r.monthly){
  if(!row||Object.keys(row).sort().join(',')!=='used,wire'||typeof row.wire!=='string'||!Number.isSafeInteger(row.used)||row.used<0)fail();
  const parsed=sourceJsonFields(row.wire),get=(k:string)=>jsonText(parsed.fields.get(k)?.value),payee=get('payee'),network=get('network')??'eip155:5042002',capValue=parsed.fields.get('creatorBudgetMicros'),cap=sqliteNumber(get('creatorBudgetMicros')),expires=sourceJulianDay(get('expiresAt')),created=sourceJulianDay(get('createdAt')),transaction=get('transaction');
  const integer=!!capValue&&/^-?(?:0|[1-9]\d*)$/.test(capValue.token);
  if(!parsed.object||typeof payee!=='string'||sourceAsciiLower(payee)!==input.payee||network!==input.network||!integer||cap===null||cap<=0||cap>1000000000000||expires===null||created===null||created>jd||typeof transaction!=='string'||transaction.replace(/^ +| +$/g,'')===''||row.used>4)invalid++;
  if(expires!==null&&expires>jd){const remaining=4-row.used,product=remaining*(cap??0);prepaid+=remaining;if(!Number.isNaN(product))prepaidCap+=product;if(remaining>0)largest=sqliteMax(largest,get('creatorBudgetMicros'));}
 }
 return operatorInventorySchema.parse({observedAt:now,network:input.network,queuedJobs:queued,processingJobs:processing,reviewRequiredJobs:review,invalidJobs:invalid,queuedCreatorMicroUsdc:String(queuedCap),unfinishedCreatorMicroUsdc:String(unfinishedCap),prepaidRequests:prepaid,prepaidCreatorMicroUsdc:String(Number.isNaN(prepaidCap)?0:prepaidCap),largestCreatorMicroUsdc:String(largest)});
}
export function reduceOperatorPublic(raw:unknown,now:number){
 const r=raw as {format?:unknown;rows?:NativeRecordedJobRow[];registered?:unknown};
 if(!r||Object.keys(r).sort().join(',')!=='format,registered,rows'||r.format!=='keryx-source-operator-public-v1'||!Array.isArray(r.rows)||r.rows.length>1000||Buffer.byteLength(JSON.stringify(raw))>OPERATOR_SOURCE_BYTES)fail();
 for(const row of r.rows)if(!row||Object.keys(row).sort().join(',')!=='completionCohort,createdAt,startedAt,status,updatedAt'||!['running','completed','failed'].includes(row.status)||typeof row.createdAt!=='string'||typeof row.updatedAt!=='string'||(row.startedAt!==null&&typeof row.startedAt!=='string')||!['ordinary','recovered','unknown'].includes(row.completionCohort))fail();
 return operatorPublicSnapshotSchema.parse({jobs:summarizeNativeRecordedJobs(r.rows,now),creatorCatalog:{registered:r.registered}});
}
