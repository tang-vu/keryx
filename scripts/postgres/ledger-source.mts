import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeUsageSource } from './usage-source.mts';
export function nativeLedgerSource(){
 const base=nativeUsageSource(),addition=readFileSync(new URL('../../ops/keryx-postgres/public-ledger.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');if(Buffer.byteLength(addition)>16384)throw Error('Public ledger SOURCE bound');
 const sql=base.sql+'\n'+addition;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Bounded public ledger SOURCE candidate; actual original, protocol/factory and full writer/load/cutover gates remain required.'});
}
