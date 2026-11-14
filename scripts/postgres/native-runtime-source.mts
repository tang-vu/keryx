/** Independent native SOURCE for cold read/factory qualification. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeHostedAdmissionSource } from './hosted-admission-source.mts';
export function nativeRuntimeSource(){
 const base=nativeHostedAdmissionSource(),runtime=readFileSync(new URL('../../ops/keryx-postgres/native-runtime.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(runtime)>16384)throw new Error('Native runtime SOURCE bound');
 const sql=base.sql+'\n'+runtime;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Cold read/source authority only; factory, complete application profile, full-data import and production cutover require their actual separate qualification.'});
}
