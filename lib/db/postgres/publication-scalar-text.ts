/** Source string interpretations only. This module confers no storage authority.
 *
 * The selected SQLite writer binds each scalar separately from JSON.stringify's
 * original. Node's UTF-8 binding replaces an unpaired surrogate with U+FFFD and
 * retains NUL. SQLite JSON extraction instead emits the unpaired surrogate's
 * three UTF-8-shaped bytes. Keep those interpretations separate: neither may
 * rewrite a QueryRun, original JSON, delivery body, or receipt digest.
 */
export interface PublicationScalarText {
 readonly sourceHex: string;
 /** JSON string wire for the scalar-bound value, including escaped NUL. */
 readonly sourceJsonWire: string;
 /** A SQL TEXT derivative is explicitly unavailable, never an absent scalar. */
 readonly postgres: Readonly<{kind:'text';value:string}|{kind:'unrepresentable'}>;
}

/** Exact node:sqlite scalar TEXT binding, not a sanitizer for the original. */
export function publicationScalarText(value:string):Readonly<PublicationScalarText>{
 if(typeof value!=='string')throw Error('Publication scalar text required');
 const bytes=Buffer.from(value,'utf8'),bound=bytes.toString('utf8');
 return Object.freeze({sourceHex:bytes.toString('hex'),sourceJsonWire:JSON.stringify(bound),
  postgres:Object.freeze(bound.includes('\0')?{kind:'unrepresentable' as const}:{kind:'text' as const,value:bound})});
}

/** SQLite's json_extract/json_each text value for a JSON.stringify string.
 * Valid pairs combine normally; an unpaired UTF-16 code unit is emitted as
 * ED A0..BF bytes rather than scalar binding's EF BF BD. Search consumers use
 * the bytes; metadata crossing Node's UTF-8 decoder uses the decoded result.
 */
export function publicationSqliteJsonTextHex(value:string):string{
 if(typeof value!=='string')throw Error('Publication JSON text required');
 // One bounded allocation; a run of unpaired surrogates must not allocate one
 // Buffer object per code unit while capturing an otherwise bounded original.
 const bytes=Buffer.allocUnsafe(value.length*3);let used=0;
 for(let index=0;index<value.length;index++){
  let unit=value.charCodeAt(index);
  if(unit>=0xd800&&unit<=0xdbff&&index+1<value.length){
   const next=value.charCodeAt(index+1);
   if(next>=0xdc00&&next<=0xdfff){unit=0x10000+((unit-0xd800)<<10)+(next-0xdc00);index++;}
  }
  if(unit<0x80)bytes[used++]=unit;
  else if(unit<0x800){bytes[used++]=0xc0|(unit>>6);bytes[used++]=0x80|(unit&0x3f);}
  else if(unit<0x10000){bytes[used++]=0xe0|(unit>>12);bytes[used++]=0x80|((unit>>6)&0x3f);bytes[used++]=0x80|(unit&0x3f);}
  else{bytes[used++]=0xf0|(unit>>18);bytes[used++]=0x80|((unit>>12)&0x3f);bytes[used++]=0x80|((unit>>6)&0x3f);bytes[used++]=0x80|(unit&0x3f);}
 }
 return bytes.subarray(0,used).toString('hex');
}

/** json_each.value returned through node:sqlite, not the raw JSON -> token. */
export function publicationSqliteJsonTextValue(value:string):string{
 return Buffer.from(publicationSqliteJsonTextHex(value),'hex').toString('utf8');
}

export interface PublicationScalarCell {
 readonly rawKind:'missing'|'null'|'string'|'number'|'boolean'|'array'|'object';
 /** The original JSON token's SQLite extraction bytes, before row transforms. */
 readonly rawHex:string|null;
 /** The separately bound scalar column; nullness is part of the cell. */
 readonly boundHex:string|null;
 /** Checked physical TEXT derivative. An encoded wire remains non-null. */
 readonly shadow:string|null;
}
export function publicationScalarCell(raw:string|null|undefined,bound:string|null|undefined=raw):Readonly<PublicationScalarCell>{
 if(raw!=null&&typeof raw!=='string'||bound!=null&&typeof bound!=='string')throw Error('Publication scalar cell required');
 const scalar=bound==null?null:publicationScalarText(bound);
 return Object.freeze({rawKind:raw===undefined?'missing':raw===null?'null':'string',rawHex:raw==null?null:publicationSqliteJsonTextHex(raw),boundHex:scalar?.sourceHex??null,
  shadow:scalar===null?null:scalar.postgres.kind==='text'?scalar.postgres.value:scalar.sourceJsonWire});
}

/** Fixed writer mapping only. Caller supplies a captured QueryRun, never custom
 * keys, interpretation callbacks, parser derivatives, or a proof flag. Unicode
 * asker lowercase is the protected Node parser boundary; SQL independently
 * anchors raw bytes and prevents an invalid raw owner becoming owner/absence.
 * Answer cells are kept separate so metadata reads never fetch a body map.
 */
export function publicationScalarCells(run:Readonly<import('../../types').QueryRun>){
 const cells={id:publicationScalarCell(run.id),created_at:publicationScalarCell(run.createdAt),
  question:publicationScalarCell(run.question),engine:publicationScalarCell(run.engine),parent_id:publicationScalarCell(run.parentId),
  asker:publicationScalarCell(run.asker,run.asker?.toLowerCase()),origin:publicationScalarCell(run.origin,run.origin??'engine'),
  mcp_client:publicationScalarCell(run.mcpClient),payment_mode:publicationScalarCell(run.paymentMode),confidence_level:publicationScalarCell(run.confidence?.level)};
 const metadata=Object.freeze(Object.fromEntries(Object.entries(cells).map(([key,cell])=>[key,{rawKind:cell.rawKind,boundHex:cell.boundHex,...(key==='asker'&&cell.rawHex!==cell.boundHex?{rawHex:cell.rawHex}:{})}])) as Record<keyof typeof cells,Pick<PublicationScalarCell,'rawKind'|'boundHex'>&{readonly rawHex?:string|null}>);
 const shadows=Object.freeze(Object.fromEntries(Object.entries(cells).map(([key,cell])=>[key,cell.shadow])) as Record<keyof typeof cells,string|null>);
 return Object.freeze({metadata,shadows,answer:publicationScalarCell(run.answer)});
}

const metricTextFields=['origin','asker','payment_mode','confidence_level','mcp_client'] as const;
const metricValueFields=['id','duration_ms','payment_attempts','settled_payments','evidence_claim_count','grounded_claim_count','rewarded_citation_count','economics_data'] as const;
function boundHex(value:unknown,maximum:number):string{
 if(typeof value!=='string'||value.length>maximum*2||value.length%2||/[^a-f0-9]/.test(value))throw Error('Source scalar bytes unavailable');
 // This is a Source TEXT value, so an initial U+FEFF is data, not a BOM to strip.
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Buffer.from(value,'hex'));
}
/** Fixed native metric DTO only. The five scalar fields are independent of
 * answer/question/original bytes; accepting a legacy TEXT shadow is forbidden.
 */
export function decodePublicationMetricRows(value:unknown){
 if(!Array.isArray(value)||value.length>1000||Buffer.byteLength(JSON.stringify(value))>4194304)throw Error('Source metric rows unavailable');
 return value.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Source metric row unavailable');
  const row=raw as Record<string,unknown>,hex=row.nativeScalarHex;
  if(Object.keys(row).length!==metricValueFields.length+1||Object.keys(row).some(key=>key!=='nativeScalarHex'&&!(metricValueFields as readonly string[]).includes(key))
   ||!hex||typeof hex!=='object'||Array.isArray(hex)||Object.keys(hex).length!==metricTextFields.length
   ||Object.keys(hex).some(key=>!(metricTextFields as readonly string[]).includes(key)))throw Error('Source metric scalar tuple unavailable');
  return {...Object.fromEntries(metricValueFields.map(key=>[key,row[key]])),
   ...Object.fromEntries(metricTextFields.map(key=>{const cell=Reflect.get(hex,key);return [key,cell===null?null:boundHex(cell,4000000)];}))};
 });
}

export type PublicationOriginalRead='get_query_run'|'list_follow_ups'|'list_query_runs_by_asker'|'list_recent_queries';
/** Raw original envelopes from the fixed generic application read operations.
 * No scalar normalization, body projection, sanitizer or invented original.
 */
export function decodePublicationOriginalRead(operation:PublicationOriginalRead,value:unknown):unknown{
 const one=(raw:unknown)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==1||!Object.hasOwn(raw,'nativeOriginalHex'))throw Error('Source run original unavailable');
  return {data:JSON.parse(boundHex(Reflect.get(raw,'nativeOriginalHex'),4000000)) as unknown};
 };
 if(operation==='get_query_run')return value===null?null:one(value);
 if(!['list_follow_ups','list_query_runs_by_asker','list_recent_queries'].includes(operation)||!Array.isArray(value)||value.length>1000||Buffer.byteLength(JSON.stringify(value))>33554432)throw Error('Source run originals unavailable');
 return value.map(one);
}
