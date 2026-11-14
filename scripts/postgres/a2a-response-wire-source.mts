import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeHostedAdmissionSource } from './hosted-admission-source.mts';
export function nativeA2aResponseWireSource(){
 const base=nativeHostedAdmissionSource(),part=readFileSync(new URL('../../ops/keryx-postgres/a2a-response-wire.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>32768)throw Error('A2A response wire SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Raw postpaid JSON/recorded completion metadata candidate; complete protocol candidate; repair/producers/full writer and production migration remain unqualified.'});
}
