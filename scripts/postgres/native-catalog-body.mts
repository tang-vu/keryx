/** Source-only native catalog descriptor. It retains every field and raw bound
 * of the reviewed descriptor, and materializes its measured entries once. */
import { POSTGRES17_SCHEMA_CONTRACT_BODY } from "../helpers/enrolled-postgres-schema-contract.mts";
export function nativeCatalogBody():string{
  const baseline=POSTGRES17_SCHEMA_CONTRACT_BODY;
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
