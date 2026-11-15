import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {nativeSourceObservationsOffersSource} from './source-observations-offers-source.mts';
/** Fresh Source metadata subset only, not a runtime or withdrawal issuer. */
export function nativeOperatorWithdrawalSource(){
 const part=readFileSync(new URL('../../ops/keryx-postgres/operator-withdrawal.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>32768)throw Error('Operator withdrawal Source part bound');
 const sql=nativeSourceObservationsOffersSource().sql+'\n'+part;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Operator views and reporting only; no transfer attestation, full writer or production cutover authority.'});
}
