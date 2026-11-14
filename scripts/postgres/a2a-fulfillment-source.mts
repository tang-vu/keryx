import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeSourceProducersSource } from './source-producers-source.mts';
export function nativeA2aFulfillmentSource(){
 const base=nativeSourceProducersSource(),part=readFileSync(new URL('../../ops/keryx-postgres/a2a-fulfillment.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>32768)throw Error('A2A fulfillment SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Failed-original metadata candidate only; no installed writer, execution or production cutover authority.'});
}
