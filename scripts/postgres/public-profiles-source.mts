/** Opt-in public profiles only; no implicit activation or financial write. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeChatLinksSource } from './chat-links-source.mts';
export function nativePublicProfilesSource(){
 const base=nativeChatLinksSource(),part=readFileSync(new URL('../../ops/keryx-postgres/public-profiles.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>24576)throw Error('Public profiles SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Opt-in publication protocol candidate; complete writer, materialization and production cutover require separate qualification.'});
}
