import { createHash } from 'node:crypto';

/** Source-owned descriptor, for a separate fresh reference database only.
 * No connection, environment lookup, enrollment target, or adoption API lives here.
 * The caller must execute the body in one coherent read transaction with a native
 * statement deadline. Bounds limit export allocations, not PostgreSQL native RSS.
 */
export const POSTGRES17_SCHEMA_CONTRACT_LIMITS = Object.freeze({
  functions: 512, relations: 512, columns: 4096, roles: 128,
  entries: 16384, fieldBytes: 131072, aggregateBytes: 8388608,
  migrationBytes: 16777216,
});
const schemas = "('public','keryx_storage')";
const inScope = `n.nspname in ${schemas}`;

// Preserve NULL ACL vs explicit ACL as well as resolved grants. In particular,
// PUBLIC, grant options and grantors are not flattened into privilege booleans.
function acl(expression: string, defaults?: readonly [string, string]): string {
  const effective = defaults ? `coalesce(${expression},acldefault(${defaults[0]},${defaults[1]}))` : expression;
  return `jsonb_build_object('explicit',${expression} is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(${effective}) z))`;
}
const descriptors: readonly [string, string][] = [
  ['database', `select jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,
    'ctype',d.datctype,'localeProvider',d.datlocprovider,'locale',d.datlocale,
    'icuRules',d.daticurules,'collationVersion',d.datcollversion,
    'actualCollationVersion',pg_database_collation_actual_version(d.oid),'allowConnections',d.datallowconn,
    'connectionLimit',d.datconnlimit,'owner',pg_get_userbyid(d.datdba),'acl',${acl('d.datacl', ["'d'", 'd.datdba'])}) value
    from pg_database d where d.datname=current_database()`],
  ['schemas', `select jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',${acl('n.nspacl', ["'n'", 'n.nspowner'])}) value
    from pg_namespace n where ${inScope}`],
  ['relations', `select jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),'acl',${acl('c.relacl', ["case when c.relkind='S' then 's'::\"char\" else 'r'::\"char\" end", 'c.relowner'])},
    'options',c.reloptions,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
    'replicaIdentity',c.relreplident,'accessMethod',am.amname,'partition',pg_get_expr(c.relpartbound,c.oid),
    'partitionKey',pg_get_partkeydef(c.oid),
    'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end) value
    from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_am am on am.oid=c.relam where ${inScope}`],
  ['columns', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',a.attname,
    'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
    'acl',${acl('a.attacl', ["'c'", 'c.relowner'])},'storage',a.attstorage,'compression',a.attcompression,'options',a.attoptions,
    'collation',case when co.oid is null then null else cn.nspname||'.'||co.collname end) value
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on (d.adrelid,d.adnum)=(a.attrelid,a.attnum)
    left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
    where ${inScope} and a.attnum>0 and not a.attisdropped`],
  ['constraints', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',x.conname,
    'type',x.contype,'definition',pg_get_constraintdef(x.oid,false),'validated',x.convalidated,
    'deferrable',x.condeferrable,'initiallyDeferred',x.condeferred,'noInherit',x.connoinherit,
    'parent',px.conname,'referencedSchema',rn.nspname,'referencedRelation',rc.relname) value
    from pg_constraint x join pg_namespace n on n.oid=x.connamespace
    left join pg_class c on c.oid=x.conrelid left join pg_class rc on rc.oid=x.confrelid
    left join pg_namespace rn on rn.oid=rc.relnamespace left join pg_constraint px on px.oid=x.conparentid where ${inScope}`],
  ['indexes', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',ic.relname,
    'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,
    'live',i.indislive,'unique',i.indisunique,'nullsNotDistinct',i.indnullsnotdistinct,
    'primary',i.indisprimary,'exclusion',i.indisexclusion,'immediate',i.indimmediate,
    'clustered',i.indisclustered,'replicaIdentity',i.indisreplident) value
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_class ic on ic.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where ${inScope}`],
  ['triggers', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,
    'name',case when t.tgisinternal then null else t.tgname end,
    'definition',case when t.tgisinternal then null else pg_get_triggerdef(t.oid,false) end,
    'constraint',x.conname,'functionSchema',fn.nspname,'function',f.proname,
    'functionArguments',pg_get_function_identity_arguments(f.oid),'type',t.tgtype,
    'args',encode(t.tgargs,'hex'),'enabled',t.tgenabled,'internal',t.tgisinternal,
    'deferrable',t.tgdeferrable,'initiallyDeferred',t.tginitdeferred,
    'referencedSchema',rn.nspname,'referencedRelation',rc.relname,
    'oldTable',t.tgoldtable,'newTable',t.tgnewtable,
    'when',pg_get_expr(t.tgqual,t.tgrelid),
    'columns',(select coalesce(jsonb_agg(a.attname order by u.ord),'[]'::jsonb)
      from unnest(t.tgattr::smallint[]) with ordinality u(num,ord)
      join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=u.num)) value
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_proc f on f.oid=t.tgfoid join pg_namespace fn on fn.oid=f.pronamespace
    left join pg_constraint x on x.oid=t.tgconstraint left join pg_class rc on rc.oid=t.tgconstrrelid
    left join pg_namespace rn on rn.oid=rc.relnamespace where ${inScope}`],
  ['functions', `select jsonb_build_object('schema',n.nspname,'name',p.proname,'kind',p.prokind,
    'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'definition',case when p.prokind='a' then null else pg_get_functiondef(p.oid) end,
    'source',p.prosrc,'binary',p.probin,'language',l.lanname,'owner',pg_get_userbyid(p.proowner),
    'acl',${acl('p.proacl', ["'f'", 'p.proowner'])},'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,
    'strict',p.proisstrict,'returnsSet',p.proretset,'volatility',p.provolatile,'parallel',p.proparallel,
    'cost',p.procost::text,'rows',p.prorows::text,'settings',p.proconfig,
    'support',case when p.prosupport=0 then null else p.prosupport::regprocedure::text end) value
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where ${inScope}`],
  ['policies', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',p.polname,
    'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(
      case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) value
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}`],
  ['defaults', `select jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,
    'objectType',d.defaclobjtype,'acl',${acl('d.defaclacl')}) value from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace`],
  ['roles', `select jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,
    'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'login',r.rolcanlogin,
    'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,
    'validUntil',(r.rolvaliduntil at time zone 'UTC')::text,'settings',r.rolconfig) value from pg_roles r`],
  ['memberships', `select jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
    'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) value from pg_auth_members m`],
  ['roleSettings', `select jsonb_build_object('role',case when s.setrole=0 then 'ALL' else pg_get_userbyid(s.setrole) end,
    'database',case when s.setdatabase=0 then 'ALL' else 'CURRENT' end,'settings',s.setconfig) value
    from pg_db_role_setting s where s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())`],
  ['inheritance', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'parentSchema',pn.nspname,
    'parent',p.relname,'sequence',i.inhseqno,'detachPending',i.inhdetachpending) value
    from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_class p on p.oid=i.inhparent join pg_namespace pn on pn.oid=p.relnamespace where ${inScope}`],
  ['sequenceOwnership', `select jsonb_build_object('schema',n.nspname,'sequence',s.relname,
    'relationSchema',rn.nspname,'relation',r.relname,'column',a.attname,'dependency',d.deptype) value
    from pg_depend d join pg_class s on d.classid='pg_class'::regclass and d.objid=s.oid and s.relkind='S'
    join pg_namespace n on n.oid=s.relnamespace join pg_class r on d.refclassid='pg_class'::regclass and d.refobjid=r.oid
    join pg_namespace rn on rn.oid=r.relnamespace join pg_attribute a on a.attrelid=r.oid and a.attnum=d.refobjsubid
    where ${inScope} and d.deptype in ('a','i')`],
  ['sequences', `select jsonb_build_object('schema',n.nspname,'name',c.relname,'type',format_type(s.seqtypid,null),
    'start',s.seqstart::text,'increment',s.seqincrement::text,'minimum',s.seqmin::text,
    'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle) value
    from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}`],
  ['types', `select jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,
    'owner',pg_get_userbyid(t.typowner),'notNull',t.typnotnull,'base',case when t.typbasetype=0 then null else format_type(t.typbasetype,t.typtypmod) end,
    'default',t.typdefault,'acl',${acl('t.typacl', ["'T'", 't.typowner'])},'category',t.typcategory,'preferred',t.typispreferred,
    'delimiter',t.typdelim,'length',t.typlen,'byValue',t.typbyval,'alignment',t.typalign,'storage',t.typstorage,
    'element',case when t.typelem=0 then null else format_type(t.typelem,null) end,
    'input',t.typinput::regprocedure::text,'output',t.typoutput::regprocedure::text,
    'receive',case when t.typreceive=0 then null else t.typreceive::regprocedure::text end,
    'send',case when t.typsend=0 then null else t.typsend::regprocedure::text end,
    'modifierInput',case when t.typmodin=0 then null else t.typmodin::regprocedure::text end,
    'modifierOutput',case when t.typmodout=0 then null else t.typmodout::regprocedure::text end,
    'analyze',case when t.typanalyze=0 then null else t.typanalyze::regprocedure::text end,
    'enum',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) value
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${inScope}`],
  ['rules', `select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',r.rulename,
    'enabled',r.ev_enabled,'definition',pg_get_ruledef(r.oid,false)) value
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where ${inScope}`],
  ['collations', `select jsonb_build_object('schema',n.nspname,'name',c.collname,'owner',pg_get_userbyid(c.collowner),
    'provider',c.collprovider,'deterministic',c.collisdeterministic,'encoding',c.collencoding,
    'collate',c.collcollate,'ctype',c.collctype,'locale',c.colllocale,'icuRules',c.collicurules,
    'version',c.collversion,'actualVersion',pg_collation_actual_version(c.oid)) value from pg_collation c join pg_namespace n on n.oid=c.collnamespace
    where ${inScope} or c.oid in (select a.attcollation from pg_attribute a join pg_class r on r.oid=a.attrelid
      join pg_namespace rn on rn.oid=r.relnamespace where rn.nspname in ${schemas})`],
  ['operations', `select jsonb_build_object('operation',o.operation,'relations',o.relations,
    'realOnly',o.real_only,'readOnly',o.read_only) value from keryx_storage.operations o`],
];

/** The owner embeds this exact body in its private descriptor function. No arbitrary
 * exclusions: the descriptor includes itself; final source generation must occur
 * after installation of this body. Functions carrying expected metadata need a
 * separately reviewed exact-structure exception owned by the cutover implementation.
 */
export const POSTGRES17_SCHEMA_CONTRACT_BODY = `
declare result jsonb; bytes bigint; rows_count bigint;
begin
  if current_setting('server_version_num')::integer/10000<>17 then raise exception 'unsupported schema contract version'; end if;
  if exists(select 1 from pg_namespace where nspname not in ('public','keryx_storage','information_schema')
    and nspname !~ '^pg_') then raise exception 'unsupported schema contract namespace'; end if;
  -- Reviewed migrations do not define foreign objects/custom operator families.
  -- Refuse these rather than silently omitting their security semantics.
  if exists(select 1 from pg_foreign_table f join pg_class c on c.oid=f.ftrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope})
    or exists(select 1 from pg_operator o join pg_namespace n on n.oid=o.oprnamespace where ${inScope})
    or exists(select 1 from pg_opclass o join pg_namespace n on n.oid=o.opcnamespace where ${inScope})
    or exists(select 1 from pg_opfamily o join pg_namespace n on n.oid=o.opfnamespace where ${inScope})
    or exists(select 1 from pg_conversion o join pg_namespace n on n.oid=o.connamespace where ${inScope})
    or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${inScope} and t.typtype in ('r','m'))
    then raise exception 'unsupported schema contract object'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${inScope})>512
    or (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${inScope})>512
    or (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope} and a.attnum>0)>4096
    or (select count(*) from pg_roles)>128 then raise exception 'schema contract count bound'; end if;
  if (select count(*) from (
    select c.oid from pg_constraint c join pg_namespace n on n.oid=c.connamespace where ${inScope}
    union all select t.oid from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select t.oid from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${inScope}
    union all select p.oid from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select oid from pg_auth_members
    union all select oid from pg_default_acl
    union all select r.oid from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select e.oid from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where ${inScope}
  ) raw_metadata)>16384 then raise exception 'schema contract count bound'; end if;
  with fields as (
    select octet_length(d.adbin::text) bytes from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    -- Budget encoded trigger arguments at TWO bytes per raw byte, without first
    -- allocating hex text. Qualifier nodes are measured before any deparsing.
    union all select 2::bigint*octet_length(t.tgargs)::bigint+octet_length(coalesce(t.tgqual::text,''))::bigint from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select octet_length(coalesce(x.conbin::text,'')) from pg_constraint x join pg_namespace n on n.oid=x.connamespace where ${inScope}
    union all select octet_length(coalesce(c.reloptions::text,''))+octet_length(coalesce(c.relacl::text,'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select octet_length(coalesce(p.polqual::text,''))+octet_length(coalesce(p.polwithcheck::text,'')) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select octet_length(r.ev_action::text)+octet_length(r.ev_qual::text) from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where ${inScope}
    union all select octet_length(coalesce(r.rolconfig::text,'')) from pg_roles r
    union all select octet_length(coalesce(s.setconfig::text,'')) from pg_db_role_setting s
    union all select octet_length(d.defaclacl::text) from pg_default_acl d
    union all select octet_length(coalesce(t.typdefault,''))+octet_length(coalesce(t.typacl::text,'')) from pg_type t join pg_namespace n on n.oid=t.typnamespace where ${inScope}
  ) select count(*),coalesce(sum(fields.bytes),0) into rows_count,bytes from fields having coalesce(max(fields.bytes),0)<=131072;
  if rows_count is null or rows_count>16384 or bytes>8388608 then raise exception 'schema contract raw field bound'; end if;
  -- Raw stored fields are bounded BEFORE pg_get_* deparsing/json aggregation.
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${inScope}
      and (octet_length(p.prosrc)>131072 or octet_length(coalesce(p.probin,''))>131072
        or octet_length(coalesce(p.proconfig::text,''))>131072))
    or (select coalesce(sum(octet_length(p.prosrc)+octet_length(coalesce(p.probin,''))+octet_length(coalesce(p.proconfig::text,''))),0)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where ${inScope})>8388608
    then raise exception 'schema contract source bound'; end if;
  -- Each descriptor row is checked before the final aggregate. The second pass is
  -- coherent under the enclosing transaction snapshot; caller must retain that scope.
  with entries as (${descriptors.map(([section, sql]) => `select '${section}' section,value from (${sql}) d`).join('\nunion all\n')})
  select count(*),coalesce(sum(octet_length(value::text)),0) into rows_count,bytes from entries
    having coalesce(max(octet_length(value::text)),0)<=131072;
  if rows_count is null or rows_count>16384 or bytes>8388608 then raise exception 'schema contract metadata bound'; end if;
  with entries as (${descriptors.map(([section, sql]) => `select '${section}' section,value from (${sql}) d`).join('\nunion all\n')}),
  sections as (select section,jsonb_agg(value order by value::text collate "C") items from entries group by section),
  names(section) as (values ${descriptors.map(([name]) => `('${name}')`).join(',')})
  select jsonb_build_object('format','keryx-postgres17-runtime-contract-v1','major',17,'sections',
    jsonb_object_agg(names.section,coalesce(sections.items,'[]'::jsonb))) into result from names left join sections using(section);
  if octet_length(result::text)>8388608 then raise exception 'schema contract export bound'; end if;
  return result;
end;
`;

// Query supplied only to a harness that installs the source-owned descriptor in a
// separately created reference database. Never execute against an enrollment target
// to generate its own expected contract.
export const POSTGRES17_SCHEMA_CONTRACT_QUERY = `begin isolation level repeatable read read only;
set local statement_timeout='15s'; set local lock_timeout='5s';
set local search_path=pg_catalog,pg_temp; set local timezone='UTC';
select keryx_storage.catalog_contract(); commit;`;

function refuse(): never { throw new Error('PostgreSQL schema contract refused'); }
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
function postgresJsonText(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(postgresJsonText).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const keys=Object.keys(value).sort((a,b)=>Buffer.byteLength(a)-Buffer.byteLength(b)||Buffer.compare(Buffer.from(a),Buffer.from(b)));
    return `{${keys.map(key=>`${JSON.stringify(key)}: ${postgresJsonText(value[key])}`).join(', ')}}`;
  }
  return JSON.stringify(value);
}
function copyJson(input: unknown, budget: { bytes: number; entries: number }, depth = 0): Json {
  if (depth > 32 || --budget.entries < 0) refuse();
  if (input === null || typeof input === 'boolean') return input;
  if (typeof input === 'number') { if (!Number.isSafeInteger(input)) refuse(); return input; }
  if (typeof input === 'string') {
    const bytes = Buffer.byteLength(input, 'utf8');
    if (bytes > POSTGRES17_SCHEMA_CONTRACT_LIMITS.fieldBytes || (budget.bytes -= bytes) < 0 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(input)) refuse();
    return input;
  }
  if (typeof input !== 'object') refuse();
  const proto = Object.getPrototypeOf(input);
  if (Array.isArray(input)) {
    if (proto !== Array.prototype || input.length > 16384) refuse();
    const desc = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(desc).length !== input.length + 1) refuse();
    const copied: Json[] = [];
    for (let index=0;index<input.length;index++) { if (!desc[index] || !('value' in desc[index])) refuse(); copied.push(copyJson(desc[index].value, budget, depth + 1)); }
    return copied;
  }
  if (proto !== Object.prototype && proto !== null) refuse();
  const desc = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(desc).some(key => typeof key !== 'string')) refuse();
  const out: { [key: string]: Json } = Object.create(null);
  for (const key of Object.keys(desc).sort()) {
    if (!desc[key].enumerable || !('value' in desc[key]) || Buffer.byteLength(key)>256) refuse();
    out[key] = copyJson(desc[key].value, budget, depth + 1);
  }
  return out;
}
export function exportPostgres17SchemaContract(input: unknown) {
  const metadata = copyJson(input, { bytes: 8388608, entries: 262144 });
  if (metadata === null || Array.isArray(metadata) || typeof metadata !== 'object'
    || metadata.format !== 'keryx-postgres17-runtime-contract-v1' || metadata.major !== 17
    || Object.keys(metadata).join('|') !== 'format|major|sections') refuse();
  const sections = metadata.sections;
  if (sections === null || Array.isArray(sections) || typeof sections !== 'object') refuse();
  const expected = descriptors.map(([name]) => name).sort();
  const keys = Object.keys(sections).sort();
  if (keys.length !== expected.length || keys.some((key, i) => key !== expected[i])) refuse();
  for (const key of keys) {
    const section = sections[key];
    if (!Array.isArray(section)) refuse();
    const limit = key === 'functions' || key === 'relations' ? 512 : key === 'columns' ? 4096 : key === 'roles' ? 128 : 16384;
    if (section.length > limit) refuse();
    section.sort((a,b) => Buffer.compare(Buffer.from(postgresJsonText(a)),Buffer.from(postgresJsonText(b))));
  }
  const canonicalJson = JSON.stringify(metadata);
  if (Buffer.byteLength(canonicalJson)>8388608) refuse();
  function freeze(value: Json): void { if(value!==null&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);} }
  freeze(metadata);
  return Object.freeze({ metadata, canonicalJson, sha256: createHash('sha256').update(canonicalJson).digest('hex') });
}

type Token = Readonly<{ text: string; kind: 'word' | 'quoted' | 'literal' | 'punct'; start: number; end: number }>;
/** PostgreSQL lexical boundary scanner: nested comments, doubled quotes, E strings,
 * and dollar bodies are indivisible. It does not execute PL/pgSQL or resolve types.
 */
function tokens(sql: string): Token[] {
  const out: Token[] = []; let i=0;
  while (i<sql.length) {
    if (/\s/u.test(sql[i])) { i++; continue; }
    if (sql.startsWith('--',i)) { const end=sql.indexOf('\n',i+2); i=end<0?sql.length:end+1; continue; }
    if (sql.startsWith('/*',i)) {
      i+=2; let depth=1;
      while (i<sql.length && depth) { if(sql.startsWith('/*',i)){depth++;i+=2;} else if(sql.startsWith('*/',i)){depth--;i+=2;} else i++; }
      if(depth) refuse(); continue;
    }
    const start=i; const escape=(sql[i]==='E'||sql[i]==='e')&&sql[i+1]==="'";
    if(sql[i]==="'"||sql[i]==='"'||escape) {
      const quote=escape?sql[++i]:sql[i]; i++; let closed=false;
      while(i<sql.length){if(escape&&sql[i]==='\\'){i+=2;continue;} if(sql[i]===quote){if(sql[i+1]===quote){i+=2;continue;}i++;closed=true;break;}i++;}
      if(!closed) refuse(); out.push({text:sql.slice(start,i),kind:quote==='"'?'quoted':'literal',start,end:i}); continue;
    }
    const dollar=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(sql.slice(i));
    if(dollar){const tag=dollar[0];const end=sql.indexOf(tag,i+tag.length);if(end<0)refuse();i=end+tag.length;out.push({text:sql.slice(start,i),kind:'literal',start,end:i});continue;}
    const word=/^[A-Za-z_][A-Za-z_0-9$]*/u.exec(sql.slice(i));
    if(word){i+=word[0].length;out.push({text:word[0].toLowerCase(),kind:'word',start,end:i});continue;}
    i++;out.push({text:sql[start],kind:'punct',start,end:i});
    if(out.length>500000)refuse();
  }
  return out;
}
export type FunctionDeclarationEvent = Readonly<{
  migration: string; action: 'create' | 'replace' | 'drop' | 'rename' | 'generated';
  name: string; signature: string; renamedTo?: string; sourceSha256: string;
  body?: string; generatedLiterals?: readonly string[];
}>;
function literalContent(text: string): string {
  const dollar=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/u.exec(text);
  if(dollar)return text.slice(dollar[0].length,-dollar[0].length);
  // A declaration with escape-string body needs native decoding; never guess.
  if(/^[eE]/u.test(text))refuse();
  if(text[0]!=="'"||text.at(-1)!=="'")refuse();
  return text.slice(1,-1).replaceAll("''","'");
}
export function compileFunctionDeclarationManifest(migrations: readonly Readonly<{ name: string; sql: string }>[]) {
  if(!Array.isArray(migrations)||migrations.length>128)refuse();
  let total=0; const events:FunctionDeclarationEvent[]=[];
  let previousName='';
  const arrayDescriptors=Object.getOwnPropertyDescriptors(migrations);
  if(Reflect.ownKeys(arrayDescriptors).length!==migrations.length+1)refuse();
  for(let index=0;index<migrations.length;index++){
    const item=arrayDescriptors[index];if(!item||!('value'in item))refuse();
    const raw=item.value as unknown;
    if(raw===null||typeof raw!=='object'||Object.getPrototypeOf(raw)!==Object.prototype)refuse();
    const descriptors=Object.getOwnPropertyDescriptors(raw);const keys=Reflect.ownKeys(descriptors);
    if(keys.length!==2||!keys.includes('name')||!keys.includes('sql')||!('value'in descriptors.name)||!('value'in descriptors.sql))refuse();
    const migration={name:descriptors.name.value as unknown,sql:descriptors.sql.value as unknown};
    if(typeof migration.name!=='string'||!/^\d{4}_[a-z0-9_]+\.sql$/u.test(migration.name)||typeof migration.sql!=='string')refuse();
    if(migration.name<=previousName)refuse();previousName=migration.name;
    total+=Buffer.byteLength(migration.sql);if(total>16777216)refuse();
    const ts=tokens(migration.sql); let start=0;
    for(let end=0;end<=ts.length;end++){
      if(end<ts.length&&ts[end].text!==';')continue;
      const statement=ts.slice(start,end);start=end+1;if(!statement.length)continue;
      const words=statement.map(t=>t.text);const first=words[0];let action:FunctionDeclarationEvent['action'];let at:number;
      if(first==='create'&&words[1]==='function'){action='create';at=2;}
      else if(first==='create'&&words[1]==='or'&&words[2]==='replace'&&words[3]==='function'){action='replace';at=4;}
      else if(first==='drop'&&words[1]==='function'){action='drop';at=words[2]==='if'&&words[3]==='exists'?4:2;}
      else if(first==='alter'&&words[1]==='function'){action='rename';at=2;if(!words.includes('rename'))continue;}
      else if(first==='do'){
        const body=statement.find(t=>t.kind==='literal');if(!body)refuse();
        // Dynamic generators are retained whole and source-hashed, never mistaken
        // for static declarations. Fresh reference generation must resolve them.
        const bodyTokens=tokens(literalContent(body.text));
        const literals=bodyTokens.filter(token=>token.kind==='literal').map(token=>literalContent(token.text));
        if(bodyTokens.some(token=>token.kind==='word'&&token.text==='execute'))events.push(Object.freeze({migration:migration.name,action:'generated',name:'<native-reference-required>',signature:body.text,
          generatedLiterals:Object.freeze(literals),sourceSha256:createHash('sha256').update(body.text).digest('hex')}));
        continue;
      }else continue;
      const open=words.indexOf('(',at);if(open<0)refuse();
      let depth=1;let close=open+1;while(close<words.length&&depth){if(words[close]==='(')depth++;if(words[close]===')')depth--;close++;}if(depth)refuse();
      const name=words.slice(at,open).join('');if(!name||words.slice(at,open).some((_,i)=>!['word','quoted','punct'].includes(statement[at+i].kind)))refuse();
      const signature=words.slice(open+1,close-1).join(' ');
      const renameAt=words.indexOf('rename',close);const renamedTo=action==='rename'?words[renameAt+2]:undefined;
      if(action==='rename'&&(words[renameAt+1]!=='to'||!renamedTo))refuse();
      const source=migration.sql.slice(statement[0].start,statement[statement.length-1].end);
      const asAt=words.indexOf('as',close);
      const body=action==='create'||action==='replace'?statement[asAt+1]:undefined;
      if((action==='create'||action==='replace')&&(asAt<0||body?.kind!=='literal'))refuse();
      if(action==='drop'&&words.slice(close).includes(','))refuse(); // no silent partial multi-drop
      events.push(Object.freeze({migration:migration.name,action,name,signature,...(renamedTo?{renamedTo}:{}),
        ...(body?{body:literalContent(body.text)}:{}),sourceSha256:createHash('sha256').update(source).digest('hex')}));
      if(events.length>4096)refuse();
    }
  }
  return Object.freeze(events);
}
