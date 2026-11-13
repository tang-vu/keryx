/** Fixed final original/privacy/claim/account observation, without writer admission. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeAccountsSource } from './accounts-source.mts';
export function nativeAccountHistorySource(){
 const base=nativeAccountsSource(),part=readFileSync(new URL('../../ops/keryx-postgres/account-history.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>16384)throw Error('Account history SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Candidate final account history observation only; genuine route/factory, full writer, data, capacity and cutover acceptance still required.'});
}
