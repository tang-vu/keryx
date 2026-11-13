/** Candidate fixed membership journal SOURCE; no installed writer authority. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeAcceptanceSource } from './acceptance-source.mts';
export function nativeAccountsSource(){
 const base=nativeAcceptanceSource(),parts=['accounts-read.sql','accounts-write.sql'].map(name=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n'));
 if(parts.some(part=>Buffer.byteLength(part)>32768))throw Error('Account SOURCE bound');
 const sql=base.sql+'\n'+parts.join('\n');return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native account protocol candidate only. Durable current identity, single-use/CAS, genuine selected SQLite/factory/history final observation, full writer/data/load/cutover gates remain open.'});
}
