/** Fresh SOURCE representation for byte-bound retained run originals. Never an
 * ALTER/normalizer of an existing target or permission to enroll a writer. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { nativePersonalHistorySource } from './personal-history-source.mts';
const once=(sql:string,before:string,after:string)=>{if(sql.split(before).length!==2)throw new Error('Original JSON SOURCE changed; review required');return sql.replace(before,()=>after);};
export function nativeOriginalJsonSource(){
 const base=nativePersonalHistorySource();
 let sql=once(base.sql,'  answer text,\n  data jsonb not null\n);\ncreate index if not exists query_runs_created_idx',
  '  answer text,\n  data json not null\n);\ncreate index if not exists query_runs_created_idx');
 // PG's JSON accessors decode unrelated escaped NUL/surrogates too. Consume a
 // bound derivative; never parse or return the private original for summaries.
 const start=sql.indexOf('CREATE FUNCTION keryx_storage.personal_history_read('),end=sql.indexOf('CREATE FUNCTION public.storage_personal_history_list(');
 if(start<0||end<=start)throw new Error('Original JSON history projection unavailable');
 let history=sql.slice(start,end);
 const from=history.indexOf('    select id,created_at,question,asker,'),to=history.indexOf('  ), page as (',from);
 if(from<0||to<=from)throw new Error('Original JSON history SOURCE shape changed');
 const old=history.slice(from,to);if(history.split(old).length!==3)throw new Error('Original JSON history CTE SOURCE count changed');
 const projection=`    SELECT q.id,convert_from(decode(s.scalar_cells->'created_at'->>'boundHex','hex'),'UTF8') COLLATE "C" AS created_at,q.created_at AS native_created_instant,q.question,q.asker,q.total_spent,q.total_to_creators,q.payment_mode,(s.scalar_cells->'parent_id'->>'boundHex' IS NOT NULL) AS native_is_followup,
      s.scalar_cells->'question'->>'boundHex' AS question_hex,s.scalar_cells->'payment_mode'->>'boundHex' AS payment_mode_hex,
      CASE WHEN p.owner_invalid THEN '{"invalid":true}'::jsonb ELSE to_jsonb(p.recorded_owner) END recorded_owner,
      to_jsonb(p.funded) funded,p.provenance
    FROM public.query_runs q JOIN keryx_storage.run_history_projection p ON p.run_id=q.id JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id WHERE s.scalar_cells->'asker'->>'boundHex'=encode(convert_to(p_wallet,'UTF8'),'hex')
`;
 history=history.replaceAll(old,projection);
 // SQLite predicates, sort keys and returned cursors consume its observed TEXT
 // date. Preserve offset/sub-millisecond bytes; the native instant is not a
 // replacement. Existing strict history input/row validation remains in force.
 history=once(history,'NOT isfinite(native_row.created_at)','NOT isfinite(native_row.native_created_instant)');
 const pageAt=history.indexOf('  with selected as (');if(pageAt<0)throw Error('Original date page SOURCE changed');
 let page=history.slice(pageAt);
 for(const name of ['p_upper','p_before'])page=page.replaceAll(`(${name}->>'createdAt')::timestamptz`,`(${name}->>'createdAt') COLLATE "C"`);
 for(const name of ['from','to'])page=page.replaceAll(`(p_filters->>'${name}')::timestamptz`,`(p_filters->>'${name}') COLLATE "C"`);
 page=once(page,"to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')",'created_at');
 page=once(page,'or extract(microseconds from created_at)::bigint % 1000 <> 0','or false');
 page=page.replaceAll('created_at desc','created_at COLLATE "C" DESC NULLS LAST');
 history=history.slice(0,pageAt)+page;

 if(history.split("strpos(question,p_filters->>'search')>0").length!==3)throw Error('Original scalar search SOURCE changed');
 history=history.replaceAll("strpos(question,p_filters->>'search')>0","position(convert_to(p_filters->>'search','UTF8') IN decode(question_hex,'hex'))>0");
 history=once(history,"'question',question,","'questionHex',question_hex,");
 history=once(history,"'paymentMode',payment_mode,","'paymentModeHex',payment_mode_hex,");
 history=once(history,'PERFORM keryx_storage.personal_history_context(p_wallet);',`PERFORM keryx_storage.personal_history_context(p_wallet);
 IF EXISTS(SELECT 1 FROM public.query_runs q LEFT JOIN keryx_storage.run_history_projection p ON p.run_id=q.id JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id WHERE s.scalar_cells->'asker'->>'boundHex'=encode(convert_to(p_wallet,'UTF8'),'hex') AND p.run_id IS NULL)
 THEN RAISE EXCEPTION 'native original history projection unavailable';END IF;`);
 if(/\bdata\b/.test(history))throw new Error('Original JSON summary must not read the raw original');
 sql=sql.slice(0,start)+history+sql.slice(end)+'\n'+readFileSync(new URL('../../ops/keryx-postgres/original-json.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Lossless original JSON SOURCE only. Claim/privacy/publication protocols, materialization and full writer runtime still require independent behavioral qualification.'});
}
