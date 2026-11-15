import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeOperatorWithdrawalSource} from './operator-withdrawal-source.mts';
/** Fresh protocol subset; no archive import or installed writer authority. */
export function nativeReferenceArchiveSource(){
 const part=readFileSync(new URL('../../ops/keryx-postgres/reference-archive.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>32768)throw Error('Reference archive Source part bound');
 const sql=nativeOperatorWithdrawalSource().sql+'\n'+part;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Reference archive data protocol only. Complete Source intake, installed writer and production cutover require separate acceptance.'});
}
