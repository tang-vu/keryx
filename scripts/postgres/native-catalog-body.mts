/** Source-only native catalog descriptor. It retains every field and raw bound
 * of the reviewed descriptor, and materializes its measured entries once. */
import { POSTGRES17_SCHEMA_CONTRACT_BODY } from "../helpers/enrolled-postgres-schema-contract.mts";
/** PG17.12 stores a WAL LSN in the backend-owned pg_attver column option.
 * It differs across independent installations and is not schema authority.
 * Keep every other option (including near matches and malformed values).
 * https://github.com/postgres/postgres/blob/REL_17_STABLE/src/backend/catalog/README.attver.md
 * Historical Supabase manifests remain exact, with their original PG17.11 fixture.
 */
export function nativePostgres17DescriptorBody():string{
 const source=POSTGRES17_SCHEMA_CONTRACT_BODY,before="'options',a.attoptions,";
 if(source.split(before).length!==3)throw new Error('Native column option descriptor changed');
 return source.replaceAll(before,()=>`'options',CASE WHEN current_setting('server_version_num')::integer>=170012
  AND (SELECT count(*) FROM unnest(a.attoptions) v WHERE v LIKE 'pg_attver=%')=1
  AND EXISTS(SELECT 1 FROM unnest(a.attoptions) v WHERE CASE WHEN v ~ '^pg_attver=(0|[1-9][0-9]{0,19})$'
   THEN split_part(v,'=',2)::numeric<=18446744073709551615 ELSE false END)
  THEN nullif(ARRAY(SELECT v FROM unnest(a.attoptions) WITH ORDINALITY x(v,ord) WHERE v NOT LIKE 'pg_attver=%' ORDER BY ord),ARRAY[]::text[])
  ELSE a.attoptions END,`);
}
export function nativeCatalogBody():string{
  const baseline=nativePostgres17DescriptorBody();
  const start=baseline.indexOf('  -- Each descriptor row is checked before the final aggregate.');
  const final=baseline.indexOf('  with entries as (',baseline.indexOf('  with entries as (',start)+1);
  if(start<0||final<0)throw new Error('Native catalog source shape refused');
  const prefix=baseline.slice(0,start).replace('declare result jsonb; bytes bigint; rows_count bigint;',
    'declare result jsonb; bytes bigint; rows_count bigint; metadata_valid boolean;');
  let tail=baseline.slice(final).replace('with entries as (','with entries as materialized (');
  const boundary='),\n  sections as (select section,jsonb_agg(value order by value::text collate "C") items from entries group by section),';
  if(tail.split(boundary).length!==2)throw new Error('Native catalog aggregation shape refused');
  tail=tail.replace(boundary,`),
  metadata_budget as (select count(*)<=16384 and coalesce(sum(octet_length(value::text)),0)<=8388608
    and coalesce(max(octet_length(value::text)),0)<=131072 valid from entries),
  bounded_entries as (select e.* from entries e where (select valid from metadata_budget)),
  sections as (select section,jsonb_agg(value order by value::text collate "C") items from bounded_entries group by section),`);
  const result="jsonb_object_agg(names.section,coalesce(sections.items,'[]'::jsonb))) into result from names left join sections using(section);";
  if(tail.split(result).length!==2)throw new Error('Native catalog result shape refused');
  tail=tail.replace(result,"jsonb_object_agg(names.section,coalesce(sections.items,'[]'::jsonb))),(select valid from metadata_budget) into result,metadata_valid from names left join sections using(section);\n  if metadata_valid is distinct from true then raise exception 'schema contract metadata bound'; end if;");
  return prefix+'  -- Every entry is bounded before the final JSON aggregate. No metadata or admission cache.\n'+tail;
}
