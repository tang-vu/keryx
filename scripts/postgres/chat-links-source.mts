/** Current account chat associations only; no payment or complete writer authority. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeAccountHistorySource } from './account-history-source.mts';
export function nativeChatLinksSource(){
 const base=nativeAccountHistorySource(),part=readFileSync(new URL('../../ops/keryx-postgres/chat-links.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(part)>24576)throw Error('Chat links SOURCE bound');
 const sql=base.sql+'\n'+part;return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Chat-link protocol candidate; no provider envelope/consent bypass, financial authority, full writer or production cutover.'});
}
