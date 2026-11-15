import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeApplicationJsonEntrySource } from './source-json-entries.mts';

/** Append to the current complete SOURCE after operational/read compilation.
 * No base snapshot, catalog-cap increase, legacy issuer or runtime proof. */
export function nativeArticleOffersSourceAddition(){
 const schema=readFileSync(new URL('../../ops/keryx-postgres/article-offers.sql',import.meta.url),'utf8');
 const router=nativeApplicationJsonEntrySource(['set_article_offer','delete_article_offer'],true,65536,'operational_write_article_offers');
 if(Buffer.byteLength(schema)>32768||Buffer.byteLength(router)>32768)throw new Error('Article offer SOURCE part bound');
 const sql=`\nSET ROLE keryx_owner;\n${schema}\n${router}\nRESET ROLE;\n`;
 if(Buffer.byteLength(sql)>32768)throw new Error('Article offer SOURCE bound');
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Article-offer leaf only; NUL, unpaired UTF-16, unsafe/noninteger numbers and exhausted SQLite rowid allocation remain explicit holds. No installed writer authority.'});
}
