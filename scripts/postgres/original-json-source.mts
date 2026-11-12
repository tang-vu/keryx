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
 const projection=`    SELECT q.id,q.created_at,q.question,q.asker,q.total_spent,q.total_to_creators,q.payment_mode,(q.parent_id IS NOT NULL) AS native_is_followup,
      CASE WHEN p.owner_invalid THEN '{"invalid":true}'::jsonb ELSE to_jsonb(p.recorded_owner) END recorded_owner,
      to_jsonb(p.funded) funded,p.provenance
    FROM public.query_runs q JOIN keryx_storage.run_history_projection p ON p.run_id=q.id WHERE q.asker=p_wallet
`;
 history=history.replaceAll(old,projection);
 history=once(history,'PERFORM keryx_storage.personal_history_context(p_wallet);',`PERFORM keryx_storage.personal_history_context(p_wallet);
 IF EXISTS(SELECT 1 FROM public.query_runs q LEFT JOIN keryx_storage.run_history_projection p ON p.run_id=q.id WHERE q.asker=p_wallet AND p.run_id IS NULL)
 THEN RAISE EXCEPTION 'native original history projection unavailable';END IF;`);
 if(/\bdata\b/.test(history))throw new Error('Original JSON summary must not read the raw original');
 sql=sql.slice(0,start)+history+sql.slice(end)+'\n'+readFileSync(new URL('../../ops/keryx-postgres/original-json.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Lossless original JSON SOURCE only. Claim/privacy/publication protocols, materialization and full writer runtime still require independent behavioral qualification.'});
}
