import { readFileSync } from "node:fs";

// Reuse the complete catalog selection in the sealed provenance function. These
// additional reads diagnose its witness; they never replace or relax that witness.
const migration = readFileSync(new URL("../../supabase/migrations/0076_enrolled_storage_owner_cutover.sql", import.meta.url), "utf8");
const begin = migration.indexOf("select 'namespace:'", migration.indexOf("create function keryx_storage.snapshot_digest()"));
const end = migration.indexOf(") pieces;", begin);
if (begin < 0 || end <= begin) throw new Error("Sealed snapshot diagnostic source unavailable");
const pieces = migration.slice(begin, end);

/** No values, signed originals or credentials leave these read-only SQL witnesses. */
export const postgresSnapshotDiagnosticSql = `
with catalog_pieces as (${pieces}),
catalog_groups as (
 select split_part(piece, ':', 1) category,
 encode(sha256(convert_to(string_agg(piece, E'\\n' order by piece), 'UTF8')), 'hex') digest
 from catalog_pieces group by split_part(piece, ':', 1)
), relations as (
 select n.nspname,c.relname,c.relkind,c,
 (to_jsonb(c)-array['relpages','reltuples','relallvisible','relfrozenxid','relminmxid']) fields
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname not like 'pg\\_%' escape '\\' and n.nspname<>'information_schema'
), field_hashes as (
 select nspname||'.'||relname||'.'||entry.key name,
 encode(sha256(convert_to(entry.value::text,'UTF8')),'hex') digest
 from relations cross join lateral jsonb_each(fields) entry
), tables as (
 select nspname||'.'||relname name,
 encode(sha256(convert_to(query_to_xml(format(
 'select count(*) as count,coalesce(string_agg(h,'''' order by h),'''') as rows from (select encode(sha256(record_send(r)),''hex'') h from %I.%I r) rows',
 nspname,relname),true,false,'')::text,'UTF8')),'hex') digest
 from relations where relkind in ('r','p','S') and not (nspname='keryx_storage' and relname='identity')
)
select jsonb_build_object(
 'tables',(select jsonb_object_agg(name,digest order by name) from tables),
 'catalog',(select jsonb_object_agg(category,digest order by category) from catalog_groups),
 'relationFields',(select jsonb_object_agg(name,digest order by name) from field_hashes))`;

type Witness = Record<string, Record<string, string>>;
export function postgresSnapshotDiagnosticChanges(before: Witness, after: Witness) {
  return Object.fromEntries(["tables", "catalog", "relationFields"].map(category => [category,
    [...new Set([...Object.keys(before[category] ?? {}), ...Object.keys(after[category] ?? {})])].sort()
      .filter(name => before[category]?.[name] !== after[category]?.[name])
      .map(name => ({ name, beforeSha256: before[category]?.[name] ?? null, afterSha256: after[category]?.[name] ?? null }))]));
}
