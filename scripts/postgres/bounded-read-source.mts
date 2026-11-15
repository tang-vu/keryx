/** SOURCE-only read aggregation bounds. No runtime SQL selector or enrollment. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeOperationalApplicationSource } from './operational-domain-source.mts';
import { APPLICATION_READ_OPERATIONS } from '../../lib/db/postgres/application-read-calls';
const names=Object.freeze(['list_supabase_private_creator_submissions','list_sources','list_all_sources','get_items',
 'count_items_published_between','newest_item_dates','list_gap_intents','list_web_sessions','list_follow_ups',
 'list_query_runs_by_asker','list_recent_queries','list_payments','activation_funnel','list_pending_payments',
 'list_payments_by_query','list_creator_payment_attempts_by_query','list_payments_by_source','daily_settled',
 'list_withdrawals','settlement_ledger','settlement_ledger_2','list_api_keys','get_usage','load_query_memories']);
const scans=Object.freeze([
 ['scan_payment_metrics','payment_events','id,amount_usdc,source_id,source_name,query_id,kind,origin,settled,settlement_status,payer,payee,tx_hash,grant_epoch,network'],
 ['scan_query_metrics','query_runs','id,origin,asker,duration_ms,payment_mode,payment_attempts,settled_payments,confidence_level,mcp_client,evidence_claim_count,grounded_claim_count,rewarded_citation_count,economics_data'],
 ['scan_feedback_metrics','answer_feedback','id,query_id,rating'],
 ['scan_gap_metrics','gap_intents','id,status'],
 ['scan_order_economics','a2a_orders','id,query_id,creator_budget_usdc,service_fee_usdc,status,response_data'],
] as const);
const originalNames=new Set(['list_follow_ups','list_query_runs_by_asker','list_recent_queries']);
const scalarReady=`IF EXISTS(SELECT 1 FROM public.query_runs q LEFT JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id WHERE s.run_id IS NULL OR s.scalar_identity_sha256 IS DISTINCT FROM (SELECT identity_digest FROM keryx_storage.identity WHERE singleton)) THEN RAISE EXCEPTION 'native Source scalar projection unavailable';END IF;\n`;
const declarations='native_bound_row record;native_bound_bytes bigint:=2;native_bound_count integer:=0;';
function check(query:string,original=false){
 if(!/^select\s/i.test(query)||query.includes(';'))throw new Error('Bounded read SOURCE query shape refused');
 return `FOR native_bound_row IN ${query} LOOP
 ${original?`IF length(native_bound_row."nativeOriginalHex")>8000000 THEN RAISE EXCEPTION 'native original row bound';END IF;`:''}
 native_bound_count:=native_bound_count+1;
 IF native_bound_count>1000 THEN RAISE EXCEPTION 'native complete result row bound';END IF;
 native_bound_bytes:=native_bound_bytes+octet_length(to_jsonb(native_bound_row)::text)::bigint+2;
 IF native_bound_bytes>${original?33554432:4194304} THEN RAISE EXCEPTION 'native result preaggregation bound';END IF;
END LOOP;\n`;
}
export function nativeBoundedReadApplicationSource(){
 const base=nativeOperationalApplicationSource(),input=readFileSync(new URL('../../supabase/migrations/0074_enrolled_storage_domain_apis.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const functions=[...input.matchAll(/create function public\.storage_([a-z0-9_]+)\([\s\S]*?\n\$\$;/g)];
 const selected=functions.filter(m=>(names as readonly string[]).includes(m[1]));
 if(selected.length!==24||new Set(selected.map(m=>m[1])).size!==24||names.some(n=>!Object.hasOwn(APPLICATION_READ_OPERATIONS,n)))throw new Error('Bounded read SOURCE inventory changed');
 const replacements=selected.map(m=>{
  let fn=m[0];
  if(originalNames.has(m[1])){
   fn=fn.replace('select "data" from public."query_runs"',`select encode(convert_to("data"::text,'UTF8'),'hex') AS "nativeOriginalHex" from public."query_runs" q JOIN keryx_storage.run_privacy_projection sc ON sc.run_id=q.id`);
   fn=fn.replace('where "parent_id" = p_parent_id',"where sc.scalar_cells->'parent_id'->>'boundHex'=encode(convert_to(p_parent_id,'UTF8'),'hex')");
   fn=fn.replace('where "asker" = p_asker',"where sc.scalar_cells->'asker'->>'boundHex'=encode(convert_to(p_asker,'UTF8'),'hex')");
   const dateWire=`convert_from(decode(sc.scalar_cells->'created_at'->>'boundHex','hex'),'UTF8') COLLATE "C"`;
   fn=fn.replace('order by "created_at" asc',`order by ${dateWire} ASC NULLS FIRST`).replace('order by "created_at" desc',`order by ${dateWire} DESC NULLS LAST`);
   fn=fn.replace('  select coalesce(jsonb_agg',scalarReady+'  select coalesce(jsonb_agg');
  }
  const aggregate=/select coalesce\(jsonb_agg\(to_jsonb\(r\)\),'\[\]'::jsonb\) from \(([\s\S]*?)\) r into result;/g;
  const matches=[...fn.matchAll(aggregate)];
  if(matches.length!==1||fn.split('declare result jsonb;').length!==2)throw new Error('Bounded read SOURCE body changed');
  return fn.replace('create function','CREATE OR REPLACE FUNCTION').replace('declare result jsonb;','declare result jsonb;'+declarations)
   .replace(matches[0][0],check(matches[0][1],originalNames.has(m[1]))+matches[0][0]);
 });
 for(const [name,relation,columns] of scans){
  const query=name==='scan_query_metrics'?`SELECT q.id,q.duration_ms,q.payment_attempts,q.settled_payments,q.evidence_claim_count,q.grounded_claim_count,q.rewarded_citation_count,q.economics_data::text AS economics_data,
   jsonb_build_object('origin',s.scalar_cells->'origin'->>'boundHex','asker',s.scalar_cells->'asker'->>'boundHex','payment_mode',s.scalar_cells->'payment_mode'->>'boundHex','confidence_level',s.scalar_cells->'confidence_level'->>'boundHex','mcp_client',s.scalar_cells->'mcp_client'->>'boundHex') AS "nativeScalarHex"
   FROM public.query_runs q JOIN keryx_storage.run_privacy_projection s ON s.run_id=q.id ORDER BY q.id LIMIT p_limit OFFSET p_offset`:`SELECT ${columns} FROM public.${relation} ORDER BY id LIMIT p_limit OFFSET p_offset`;
  replacements.push(`CREATE OR REPLACE FUNCTION public.storage_${name}(p_expected_identity jsonb,p_offset integer,p_limit integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 DECLARE result jsonb;${declarations}
 BEGIN
  PERFORM keryx_storage.read_operation(p_expected_identity,'${name}');
  IF p_offset IS NULL OR p_offset<0 OR p_offset>200000 OR p_limit IS NULL OR p_limit<1 OR p_limit>1000 THEN RAISE EXCEPTION 'invalid complete scan bounds';END IF;
  ${name==='scan_query_metrics'?scalarReady:''}
  ${check(query)}
  SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) INTO result FROM (${query}) r;
  RETURN result;
 END;$$;`);
 }
 const get=functions.find(m=>m[1]==='get_query_run');if(!get||get[0].split('select "data" from public."query_runs"').length!==2)throw Error('Native original point read SOURCE changed');
 replacements.push(get[0].replace('create function','CREATE OR REPLACE FUNCTION').replace('  select (select to_jsonb(r)',scalarReady+`IF EXISTS(SELECT 1 FROM public.query_runs WHERE id=p_id AND octet_length(data::text)>4000000) THEN RAISE EXCEPTION 'native original row bound';END IF;\n`+'  select (select to_jsonb(r)').replace('select "data" from public."query_runs"',`select encode(convert_to("data"::text,'UTF8'),'hex') AS "nativeOriginalHex" from public."query_runs"`));
 const report=readFileSync(new URL('../../ops/keryx-postgres/dashboard-metrics.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 if(Buffer.byteLength(report)>32768)throw new Error('Native dashboard SOURCE bound exceeded');
 const sql=base.sql+'\nSET ROLE keryx_owner;\n'+replacements.join('\n')+'\nRESET ROLE;\n'+report;
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),boundedAggregates:29,
  limitations:'Aggregate allocation bounds only. A single-row encoding, whole-report accumulation, source-data readiness, remaining custom reads and full compiled runtime pressure still require qualification.'});
}
