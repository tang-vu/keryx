import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeA2aResponseWireSource } from './a2a-response-wire-source.mts';
export function nativeSourceProducersSource(){
 const base=nativeA2aResponseWireSource(),part=readFileSync(new URL('../../ops/keryx-postgres/source-claims-write.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>32768)throw Error('Source producer SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Current Source claim/upkeep producer candidate; complete application writer and production migration remain unqualified.'});
}
