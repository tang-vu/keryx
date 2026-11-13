import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeHealthSource } from './health-source.mts';
export function nativeUsageSource(){
 const base=nativeHealthSource(),addition=readFileSync(new URL('../../ops/keryx-postgres/public-usage.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');if(Buffer.byteLength(addition)>32768)throw new Error('Usage SOURCE bound');
 const sql=base.sql+'\n'+addition;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Current native public usage SOURCE candidate; actual protocol/factory/original-data and complete-writer/load/cutover gates remain required.'});
}
