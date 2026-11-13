import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativeContentWriteSource } from './content-write-source.mts';
export function nativeReviewsSource(){
 const base=nativeContentWriteSource(),reviews=readFileSync(new URL('../../ops/keryx-postgres/reviews.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(reviews)>32768)throw new Error('Native review SOURCE bound');
 const sql=base.sql+'\n'+reviews;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Decision review protocol SOURCE; full writer, remaining domains, real-data materialization and production gates remain closed.'});
}
