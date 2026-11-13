/** Recipient assignment candidate. No implicit owner execution or activation. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativePublicProfilesSource } from './public-profiles-source.mts';
export function nativeOwnerAssignmentsSource(){
 const base=nativePublicProfilesSource(),parts=['owner-assignments-support.sql','owner-assignments.sql'].map(name=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n'));
 if(parts.some(part=>Buffer.byteLength(part)>65536))throw Error('Owner assignment SOURCE bound');
 const sql=base.sql+'\n'+parts.join('\n');return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Recipient assignment protocol candidate only. No owner execution, complete writer, materialization or production cutover authority.'});
}
