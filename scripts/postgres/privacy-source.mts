import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeOwnershipHistorySource } from './ownership-history-source.mts';
export function nativePrivacySource(){
 const base=nativeOwnershipHistorySource(),addition=['privacy.sql','publication.sql'].map(name=>readFileSync(new URL('../../ops/keryx-postgres/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n')).join('\n');
 if(Buffer.byteLength(addition)>65536)throw new Error('Privacy SOURCE bound');
 const sql=base.sql+'\n'+addition;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native privacy/publication SOURCE candidate only; protocol/factory/data/full-writer/compiled-load and cutover require their actual independent qualification.'});
}
