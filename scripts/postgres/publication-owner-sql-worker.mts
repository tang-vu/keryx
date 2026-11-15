/** Private compiled publication fixture protocol. No installed store or caller SQL port. */
import {isMainThread,parentPort,workerData} from 'node:worker_threads';
import {Client} from 'pg';
import {validateStorageIdentity,type StorageIdentity} from '../../lib/db/storage-identity';
import {canonicalJson} from '../../lib/canonical-json';

export const PUBLICATION_SHARED_BYTES=16*1024*1024, PUBLICATION_HEADER_BYTES=32;
export const PUBLICATION_DATA_BYTES=PUBLICATION_SHARED_BYTES-PUBLICATION_HEADER_BYTES;
export const PUBLICATION_REPORT_BYTES=65536, PUBLICATION_INPUT_BYTES=8192;
export const PUBLICATION_STATE={initial:0,ready:1,busy:2,done:3,failed:4} as const;
export type PublicationMode='qualify'|'oom'|'limits'|'hang';
export interface PublicationChildInput{mode:PublicationMode;identity:StorageIdentity;digest:string;password:string;}
export interface PublicationLimits{memoryMax:string;swapMax:string;cpuMax:string;pidsMax:string;}
export function publicationRefused():never{throw Error('Contained publication refused');}
export function parsePublicationChildInput(raw:unknown):PublicationChildInput{
 try{
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='digest,identity,mode,password')publicationRefused();
  const x=raw as Record<string,unknown>;
  if(typeof x.mode!=='string'||!['qualify','oom','limits','hang'].includes(x.mode)||typeof x.digest!=='string'||!/^[a-f0-9]{64}$/.test(x.digest)||typeof x.password!=='string'||!/^[a-f0-9]{48}$/.test(x.password))publicationRefused();
  const identity=validateStorageIdentity(x.identity);if(identity.authorityMode!=='mainnet-real'||identity.network!=='eip155:5042')publicationRefused();
  return {mode:x.mode as PublicationMode,identity,digest:x.digest,password:x.password};
 }catch{return publicationRefused();}
}
export function assertPublicationLimits(x:PublicationLimits){
 if(x.memoryMax!=='536870912'||x.swapMax!=='0'||x.cpuMax!=='100000 100000'||x.pidsMax!=='64')throw Error('limits_refused');
}
export function assertPublicationNamespace(interfaces:readonly string[],ipv4:string,ipv6:string){
 if(interfaces.length!==1||interfaces[0]!=='lo')throw Error('network_refused');
 const v4=ipv4.trim().split(/\r?\n/).slice(1).filter(Boolean);
 if(v4.some(line=>{const f=line.trim().split(/\s+/);return f[0]!=='lo'||!f[1]?.toUpperCase().endsWith('7F')||f[2]!=='00000000'&&!f[2]?.toUpperCase().endsWith('7F');}))throw Error('network_refused');
 for(const line of ipv6.trim().split(/\r?\n/).filter(Boolean)){
  const fields=line.trim().split(/\s+/),loop=(s:string)=>s==='0'.repeat(32)||s==='0'.repeat(31)+'1';if(fields.length!==10||fields.at(-1)!=='lo'||!loop(fields[0])||!loop(fields[2])||!loop(fields[4]))throw Error('network_refused');
 }
}
/** psql -qAt: no command tags; NULL is empty, booleans t/f, bytea hex,
 * fields separated by | and rows by LF. JSON/date parsers stay raw text. */
export function formatPublicationOwnerResults(raw:unknown,maxBytes=PUBLICATION_DATA_BYTES):string{
 if(!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>PUBLICATION_DATA_BYTES)publicationRefused();
 const results=Array.isArray(raw)?raw:[raw],lines:string[]=[];let bytes=0;
 for(const result of results){
  if(!result||typeof result!=='object'||!Array.isArray(Reflect.get(result,'rows')))publicationRefused();
  for(const row of Reflect.get(result,'rows') as unknown[]){
   if(!Array.isArray(row))publicationRefused();
   const cells=row.map((value:unknown)=>{
    if(value===null)return '';if(typeof value==='boolean')return value?'t':'f';if(Buffer.isBuffer(value))return '\\x'+value.toString('hex');
    if(typeof value==='string'){if(Buffer.from(value).toString('utf8')!==value)publicationRefused();return value;}
    if(typeof value==='bigint'||typeof value==='number'&&Number.isFinite(value))return String(value);return publicationRefused();
   });
   const line=cells.join('|');bytes+=Buffer.byteLength(line)+(lines.length?1:0);if(bytes>maxBytes)publicationRefused();lines.push(line);
  }
 }
 return lines.join('\n');
}
export function publicationSqlFailure(raw:unknown):{code:string;semantic:'claim_unavailable'|'source_js_string_unavailable'|null}{
 const code=raw&&typeof raw==='object'?Reflect.get(raw,'code'):undefined,message=raw&&typeof raw==='object'?Reflect.get(raw,'message'):undefined;
 return {code:typeof code==='string'&&/^[A-Z0-9]{5}$/.test(code)?code:'XXXXX',semantic:message==='claim_unavailable'?'claim_unavailable':code==='P0001'&&message==='Source JS string token unavailable'?'source_js_string_unavailable':null};
}
export const PUBLICATION_FACTORY_BLOCKER='native-private-profile-terminal-retirement' as const;
export type PublicationObservation=Record<string,boolean|number|readonly [typeof PUBLICATION_FACTORY_BLOCKER]>;
const OBSERVATION_FIELDS=new Set(['vectors','genuineSqliteOracle','verifiedEnrolledSqlite','rawSourceDateOrder','offsetAndSubmillisecondDates','strictHistoryDateRefusal','pureFixedProtocol','rawScalarVsJsonExtraction','rawOriginalPreserved','metadataExcludesPaidAnswer','unicodeJsOwnerBoundary','noNullOwnerFallback','staleScalarRefused','erasureAfterWriterWaitRefused','largeOriginalBytes','completeCollectionBytes','largeWriteMaximumMs','lostAckUnknownNoRetry','readerRefused','unsafeCaptureStillClosed','compiled512MiBQualified','sourceProfileRefusalRetiresConnection','nativeFacadeTerminalRetirementQualified','fullFactoryBlockers','fullFactoryQualified','retainedSyntheticRows','providerCalls','paymentActions','schedulesCreated']);
const OBSERVATION_NUMBERS=new Set(['vectors','largeOriginalBytes','completeCollectionBytes','largeWriteMaximumMs','retainedSyntheticRows','providerCalls','paymentActions','schedulesCreated']);
export function validatePublicationObservation(raw:unknown):PublicationObservation{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).length!==OBSERVATION_FIELDS.size)publicationRefused();
 for(const [key,value] of Object.entries(raw)){
  if(!OBSERVATION_FIELDS.has(key))publicationRefused();
  if(key==='fullFactoryBlockers'){if(!Array.isArray(value)||value.length!==1||value[0]!==PUBLICATION_FACTORY_BLOCKER)publicationRefused();}
  else if(OBSERVATION_NUMBERS.has(key)){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>Number.MAX_SAFE_INTEGER)publicationRefused();}
  else if(typeof value!=='boolean')publicationRefused();
 }
 const x=raw as PublicationObservation;if(x.genuineSqliteOracle!==true||x.verifiedEnrolledSqlite!==true||x.rawSourceDateOrder!==true||x.offsetAndSubmillisecondDates!==true||x.strictHistoryDateRefusal!==true||x.pureFixedProtocol!==true||x.sourceProfileRefusalRetiresConnection!==true||x.nativeFacadeTerminalRetirementQualified!==false||x.compiled512MiBQualified!==false||x.fullFactoryQualified!==false||x.providerCalls!==0||x.paymentActions!==0||x.schedulesCreated!==0)publicationRefused();
 // Publish a trusted literal after exact validation; never forward a supplied
 // mutable array or any arbitrary string from Source/SQL/error objects.
 return {...x,fullFactoryBlockers:[PUBLICATION_FACTORY_BLOCKER] as const};
}
function sharedReply(shared:SharedArrayBuffer,state:number,text=''){
 if(shared.byteLength!==PUBLICATION_SHARED_BYTES)publicationRefused();const header=new Int32Array(shared,0,PUBLICATION_HEADER_BYTES/4),data=new Uint8Array(shared,PUBLICATION_HEADER_BYTES);
 const encoded=Buffer.from(text);if(encoded.length>data.length)publicationRefused();data.set(encoded);Atomics.store(header,1,encoded.length);Atomics.store(header,0,state);Atomics.notify(header,0);
}
async function workerMain(){
 const data=workerData as {shared:SharedArrayBuffer;input:unknown};if(!parentPort||!(data?.shared instanceof SharedArrayBuffer)||data.shared.byteLength!==PUBLICATION_SHARED_BYTES)publicationRefused();
 const input=parsePublicationChildInput(data.input),header=new Int32Array(data.shared,0,PUBLICATION_HEADER_BYTES/4);if(input.mode!=='qualify')publicationRefused();
 const client=new Client({host:'127.0.0.1',port:5432,user:'postgres',database:'native_target',password:input.password,ssl:false,connectionTimeoutMillis:1000,query_timeout:6000,
  options:'-c statement_timeout=5000 -c lock_timeout=1000 -c timezone=UTC -c client_encoding=UTF8 -c bytea_output=hex',application_name:'keryx-contained-publication-owner',
  // Every text result stays in the exact server representation, including the
  // required JSON114/3802 and date1082/1114/1184 types. No Date/JSON coercion.
  types:{getTypeParser:()=>((text:string)=>text)}});
 let busy=false,ended=false;
 client.on('error',()=>{if(!ended)sharedReply(data.shared,PUBLICATION_STATE.failed,JSON.stringify({code:'XXXXX',semantic:null}));});
 try{
  await client.connect();const proof=await client.query({text:"SELECT current_database(),session_user,current_setting('server_version_num'),current_setting('statement_timeout'),current_setting('lock_timeout'),pg_is_in_recovery(),(SELECT identity::text FROM keryx_storage.identity WHERE singleton),(SELECT source_digest FROM keryx_storage.source_contract WHERE singleton),(SELECT mode FROM keryx_storage.control WHERE singleton)",rowMode:'array'});
  const row=proof.rows[0];if(proof.rows.length!==1||row[0]!=='native_target'||row[1]!=='postgres'||row[2]!=='170012'||row[3]!=='5s'||row[4]!=='1s'||row[5]!=='f'||canonicalJson(JSON.parse(row[6]))!==canonicalJson(input.identity)||row[7]!==input.digest||row[8]!=='active')publicationRefused();
  sharedReply(data.shared,PUBLICATION_STATE.ready);
  parentPort.on('message',(message:unknown)=>{void (async()=>{
   try{
    if(busy||ended||Atomics.load(header,0)!==PUBLICATION_STATE.busy||!message||typeof message!=='object'||Object.keys(message).join(',')!=='sql'||typeof Reflect.get(message,'sql')!=='string')publicationRefused();
    const sql=Reflect.get(message,'sql') as string;if(!sql||Buffer.byteLength(sql)>PUBLICATION_DATA_BYTES||sql.includes('\0'))publicationRefused();busy=true;
    // No parameters/prepared statement: pg uses the simple protocol and returns
    // every statement result, including BEGIN/UPDATE/COMMIT command results.
    const result=await client.query({text:sql,rowMode:'array'});const text=formatPublicationOwnerResults(result);await client.query('ROLLBACK');sharedReply(data.shared,PUBLICATION_STATE.done,text);
   }catch(error){await client.query('ROLLBACK').catch(()=>{});sharedReply(data.shared,PUBLICATION_STATE.failed,JSON.stringify(publicationSqlFailure(error)));}
   finally{busy=false;}
  })();});
  parentPort.on('close',()=>{ended=true;void client.end();});
 }catch(error){sharedReply(data.shared,PUBLICATION_STATE.failed,JSON.stringify(publicationSqlFailure(error)));await client.end().catch(()=>{});}
}
if(!isMainThread)void workerMain().catch(()=>{const shared=workerData?.shared;if(shared instanceof SharedArrayBuffer&&shared.byteLength===PUBLICATION_SHARED_BYTES)sharedReply(shared,PUBLICATION_STATE.failed,JSON.stringify({code:'XXXXX',semantic:null}));process.exitCode=1;});
