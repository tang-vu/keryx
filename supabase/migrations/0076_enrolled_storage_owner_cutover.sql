-- Dormant private quota substrate. The owner cutover initializes and installs
-- its public-table trigger only while holding the reviewed enrollment locks.
begin;
-- Constants are populated only by a reviewed source-generated migration, never
-- target inspection or an application RPC. Their table/ACL/trigger structure is
-- part of the normative catalog; the constant values avoid hash self-reference.
-- Literal reviewed operation/mode/scope inventory. It includes trigger-mediated
-- browser capability bridges; no runtime caller selects relations or policy.
insert into keryx_storage.operations(operation,relations,real_only,read_only) values
  ('acquire_reasoning_circuit',array['reasoning_circuits']::text[],false,false),
  ('activate_browser_journal',array['browser_journal_control','browser_retained_grants','browser_signer_capacity','session_grants']::text[],true,false),
  ('admit_browser_authorization',array['browser_authorization_intents','session_grants']::text[],true,false),
  ('admit_browser_journal',array['browser_authorization_intents','browser_journal_bindings','browser_journal_writer','browser_retained_grants','browser_signer_capacity','payment_events','session_grants']::text[],true,false),
  ('admit_private_creator_submission',array['private_creator_submissions']::text[],true,false),
  ('browser_signing_admit_original',array['browser_authorization_intents','browser_journal_bindings','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_originals','browser_signing_queries','browser_signing_v2_writer','payment_events','session_grants']::text[],true,false),
  ('browser_signing_admit_query',array['browser_signing_namespaces','browser_signing_policies','browser_signing_queries']::text[],true,false),
  ('browser_signing_admit_source_original',array['browser_authorization_intents','browser_journal_bindings','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_originals','browser_signing_queries','browser_signing_v2_writer','browser_signing_v3_writer','payment_events','session_grants']::text[],true,false),
  ('browser_signing_record_signature',array['browser_journal_bindings','browser_journal_writer','browser_signing_v2_writer','payment_events']::text[],true,false),
  ('claim_a2a_order',array['a2a_orders']::text[],true,false),
  ('claim_creator_withdrawal_transfer',array['creator_withdrawal_transfer_attempts']::text[],true,false),
  ('claim_gap_intent',array['gap_intents']::text[],false,false),
  ('claim_private_research_execution',array['private_research_executions']::text[],true,false),
  ('claim_private_research_payment',array['private_research_payment_attempts']::text[],true,false),
  ('confirm_private_creator_submission',array['private_creator_confirmations']::text[],true,false),
  ('confirm_private_research_payment',array['private_research_payment_attempts']::text[],true,false),
  ('consume_auth_challenge',array['auth_challenges']::text[],false,false),
  ('consume_rate_limit',array['rate_limit_counters']::text[],false,false),
  ('create_auth_challenge',array['auth_challenges']::text[],false,false),
  ('create_gap_intent',array['gap_intents']::text[],false,false),
  ('create_web_session',array['web_sessions']::text[],false,false),
  ('disable_browser_journal_grant',array['browser_journal_writer','session_grants']::text[],true,false),
  ('fail_gap_intent',array['gap_intents']::text[],false,false),
  ('fail_pending_payment',array['payment_events','session_grants']::text[],true,false),
  ('increment_activation_event',array['activation_events']::text[],false,false),
  ('interrupt_private_research',array['private_research_interruptions']::text[],true,false),
  ('mark_a2a_payment_started',array['a2a_orders']::text[],true,false),
  ('mark_a2a_result_saving',array['a2a_orders']::text[],true,false),
  ('record_reasoning_circuit_failure',array['reasoning_circuits']::text[],false,false),
  ('release_onramp',array['sync_state']::text[],true,false),
  ('release_private_treasury',array['private_treasury_releases']::text[],true,false),
  ('release_session_grant_spend',array['session_grants']::text[],true,false),
  ('reserve_creator_withdrawal',array['creator_withdrawal_requests']::text[],true,false),
  ('reserve_onramp',array['sync_state']::text[],true,false),
  ('reserve_private_treasury',array['private_treasury_pools','private_treasury_reservations']::text[],true,false),
  ('reserve_session_grant_spend',array['session_grants']::text[],true,false),
  ('resolve_a2a_order',array['a2a_orders']::text[],true,false),
  ('save_creator_withdrawal_attestation',array['creator_withdrawal_attestations']::text[],true,false),
  ('save_private_research_result',array['private_research_results']::text[],true,false),
  ('sign_browser_journal',array['browser_journal_bindings','browser_journal_writer','payment_events']::text[],true,false),
  ('terminal_browser_journal',array['browser_journal_writer','browser_retained_grants','browser_signer_capacity','payment_events','session_grants']::text[],true,false),
  ('transition_browser_journal',array['browser_journal_writer','payment_events']::text[],true,false),
  ('upsert_api_key_usage',array['api_key_usage']::text[],false,false),
  ('upsert_browser_journal_grant',array['browser_journal_writer','browser_retained_grants','browser_signer_capacity','session_grants']::text[],true,false),
  ('a2a_operations_snapshot',array['a2a_orders']::text[],true,true),
  ('activation_funnel',array['activation_events']::text[],false,true),
  ('add_items',array['source_items']::text[],false,false),
  ('browser_journal_active',array['browser_journal_control','browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer']::text[],true,true),
  ('browser_signer_confirmed_spend_micro',array['browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer','payment_events']::text[],true,true),
  ('browser_signing_exposed_snapshot_for_signer',array['browser_journal_bindings','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_namespaces','browser_signing_originals','browser_signing_policies','browser_signing_queries','browser_signing_v2_control','browser_signing_v2_writer','browser_signing_v3_writer','payment_events','session_grants']::text[],true,true),
  ('browser_signing_header_original',array['browser_journal_writer','browser_signing_originals','browser_signing_v2_writer','browser_signing_v3_writer']::text[],true,true),
  ('browser_signing_replay_source_original',array['browser_journal_bindings','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_namespaces','browser_signing_originals','browser_signing_policies','browser_signing_queries','browser_signing_v2_barrier','browser_signing_v2_control','browser_signing_v2_writer','browser_signing_v3_writer','payment_events','session_grants']::text[],true,true),
  ('browser_signing_snapshot',array['browser_journal_bindings','browser_journal_control','browser_journal_writer','browser_retained_grants','browser_signer_capacity','browser_signing_namespaces','browser_signing_originals','browser_signing_policies','browser_signing_queries','browser_signing_v2_control','browser_signing_v2_writer','browser_signing_v3_writer','payment_events','session_grants']::text[],true,true),
  ('clear_reasoning_circuit',array['reasoning_circuits']::text[],false,false),
  ('complete_a2a_order',array['a2a_orders']::text[],true,false),
  ('count_items_published_between',array['source_items']::text[],false,true),
  ('create_a2a_order',array['a2a_orders']::text[],true,false),
  ('create_a2a_order_2',array['a2a_orders']::text[],true,true),
  ('daily_settled',array['payment_events']::text[],false,true),
  ('delete_article_offer',array['article_offers']::text[],false,false),
  ('delete_expired_rate_limits',array['rate_limit_counters']::text[],false,false),
  ('delete_expired_session_grants',array['session_grants']::text[],true,false),
  ('delete_session_grant',array['session_grants']::text[],true,false),
  ('delete_source_notify',array['source_notify']::text[],false,false),
  ('delete_source_notify_email',array['source_notify_email']::text[],false,false),
  ('expire_gap_intent',array['gap_intents']::text[],false,false),
  ('fail_a2a_order',array['a2a_orders']::text[],true,false),
  ('finish_gap_intent',array['gap_intents']::text[],false,false),
  ('get_a2a_order',array['a2a_orders']::text[],true,true),
  ('get_article_offer',array['article_offers']::text[],false,true),
  ('get_browser_journal',array['browser_authorization_intents','browser_journal_bindings','browser_journal_writer','browser_signing_v2_writer','browser_signing_v3_writer','payment_events']::text[],true,true),
  ('get_cached',array['cache_items']::text[],false,true),
  ('get_cached_at',array['cache_items']::text[],false,true),
  ('get_feedback_stats',array['answer_feedback']::text[],false,true),
  ('get_item',array['source_items']::text[],false,true),
  ('get_items',array['source_items']::text[],false,true),
  ('get_query_run',array['query_runs']::text[],false,true),
  ('get_session_grant',array['session_grants']::text[],true,true),
  ('get_source',array['sources']::text[],false,true),
  ('get_source_by_onchain_id',array['sources']::text[],false,true),
  ('get_source_meta',array['source_meta']::text[],false,true),
  ('get_source_notify',array['source_notify']::text[],false,true),
  ('get_source_notify_email',array['source_notify_email']::text[],false,true),
  ('get_supabase_private_creator_confirmation',array['private_creator_confirmations']::text[],true,true),
  ('get_supabase_private_execution',array['private_research_executions']::text[],true,true),
  ('get_supabase_private_interruption',array['private_research_interruptions']::text[],true,true),
  ('get_supabase_private_payment',array['private_research_payment_attempts']::text[],true,true),
  ('get_supabase_private_research_intent',array['private_research_intents']::text[],true,true),
  ('get_supabase_private_result',array['private_research_results']::text[],true,true),
  ('get_supabase_private_treasury',array['private_treasury_reservations']::text[],true,true),
  ('get_supabase_withdrawal_attestation',array['creator_withdrawal_attestations']::text[],true,true),
  ('get_supabase_withdrawal_request',array['creator_withdrawal_requests']::text[],true,true),
  ('get_supabase_withdrawal_transfer_claim',array['creator_withdrawal_transfer_attempts']::text[],true,true),
  ('get_sync_state',array['sync_state']::text[],false,true),
  ('get_usage',array['api_key_usage']::text[],false,true),
  ('get_user',array['users']::text[],false,true),
  ('get_web_session',array['web_sessions']::text[],false,true),
  ('inspect_runtime_readiness',array['cache_items']::text[],false,true),
  ('is_creator_wallet',array['sources']::text[],false,true),
  ('iterate_recent_queries',array['query_runs']::text[],false,true),
  ('list_a2a_orders_for_payer',array['a2a_orders']::text[],true,true),
  ('list_all_sources',array['sources']::text[],false,true),
  ('list_api_keys',array['api_keys']::text[],false,true),
  ('list_article_offers',array['article_offers']::text[],false,true),
  ('list_creator_payment_attempts_by_query',array['payment_events']::text[],false,true),
  ('list_creator_withdrawal_history',array['creator_withdrawal_requests']::text[],true,true),
  ('list_follow_ups',array['query_runs']::text[],false,true),
  ('list_gap_intents',array['gap_intents']::text[],false,true),
  ('list_payments',array['payment_events']::text[],false,true),
  ('list_payments_by_query',array['payment_events']::text[],false,true),
  ('list_payments_by_source',array['payment_events']::text[],false,true),
  ('list_pending_payments',array['payment_events']::text[],false,true),
  ('list_private_reconciliation_candidates',array['private_research_intents','private_treasury_reservations']::text[],true,true),
  ('list_private_research_history',array['private_research_intents']::text[],true,true),
  ('list_private_worker_candidates',array['private_research_executions','private_research_intents','private_research_payment_attempts','private_treasury_reservations']::text[],true,true),
  ('list_query_runs_by_asker',array['query_runs']::text[],false,true),
  ('list_recent_queries',array['query_runs']::text[],false,true),
  ('list_sources',array['sources']::text[],false,true),
  ('list_supabase_private_creator_submissions',array['private_creator_submissions']::text[],true,true),
  ('list_web_sessions',array['web_sessions']::text[],false,true),
  ('list_withdrawals',array['withdrawals']::text[],false,true),
  ('load_query_memories',array['query_memories']::text[],false,true),
  ('mark_source_notify_email_sent',array['source_notify_email']::text[],false,false),
  ('mint_api_key',array['api_keys']::text[],false,false),
  ('newest_item_dates',array['source_items']::text[],false,true),
  ('private_treasury_summary',array['private_creator_confirmations','private_creator_submissions','private_treasury_pools','private_treasury_releases','private_treasury_reservations']::text[],true,true),
  ('record_feedback',array['answer_feedback']::text[],false,false),
  ('record_payment',array['payment_events']::text[],false,false),
  ('record_payment_once',array['payment_events']::text[],false,false),
  ('record_supabase_withdrawal',array['withdrawals']::text[],true,false),
  ('record_supabase_withdrawal_2',array['withdrawals']::text[],true,true),
  ('release_supabase_private_treasury',array['private_treasury_releases']::text[],true,true),
  ('reserve_supabase_private_research_intent',array['private_research_intents']::text[],true,false),
  ('reserve_supabase_private_treasury',array['private_treasury_reservations']::text[],true,true),
  ('revoke_api_key',array['api_keys']::text[],false,false),
  ('revoke_other_web_sessions',array['web_sessions']::text[],false,false),
  ('revoke_web_session',array['web_sessions']::text[],false,false),
  ('save_query_memory',array['query_memories']::text[],false,false),
  ('save_query_run',array['query_runs']::text[],false,false),
  ('scan_feedback_metrics',array['answer_feedback']::text[],false,true),
  ('scan_gap_metrics',array['gap_intents']::text[],false,true),
  ('scan_order_economics',array['a2a_orders']::text[],false,true),
  ('scan_payment_metrics',array['payment_events']::text[],false,true),
  ('scan_query_metrics',array['query_runs']::text[],false,true),
  ('set_article_offer',array['article_offers']::text[],false,false),
  ('set_cached',array['cache_items']::text[],false,false),
  ('set_source_meta',array['source_meta']::text[],false,false),
  ('set_source_notify',array['source_notify']::text[],false,false),
  ('set_source_notify_email',array['source_notify_email']::text[],false,false),
  ('set_source_preview_depth',array['sources']::text[],false,false),
  ('set_sync_state',array['sync_state']::text[],false,false),
  ('settle_pending_payment',array['payment_events']::text[],false,false),
  ('settlement_ledger',array['payment_events']::text[],false,true),
  ('settlement_ledger_2',array['withdrawals']::text[],false,true),
  ('upsert_session_grant',array['session_grants']::text[],true,false),
  ('upsert_source',array['sources']::text[],false,false),
  ('upsert_user',array['users']::text[],false,false),
  ('verify_api_key',array['api_keys']::text[],false,true),
  ('verify_api_key_2',array['api_keys']::text[],false,false),
  ('verify_runtime_authority',array[]::text[],false,true);

create table keryx_storage.source_contract (
  phase text not null check(phase in ('before','after')),
  section text not null check(section ~ '^[a-zA-Z][a-zA-Z0-9]{0,63}$'),
  ordinal integer not null check(ordinal between -1 and 16383),
  value jsonb not null check(octet_length(value::text)<=131072),
  reference_digest text not null check(reference_digest ~ '^[0-9a-f]{64}$'),
  primary key(phase,section,ordinal),
  check((ordinal=-1 and value='null'::jsonb) or (ordinal>=0 and jsonb_typeof(value)='object'))
);
revoke all on keryx_storage.source_contract from public,anon,authenticated,service_role;
create trigger source_contract_immutable before update or delete on keryx_storage.source_contract
  for each row execute function keryx_storage.identity_immutable();
create trigger source_contract_no_truncate before truncate on keryx_storage.source_contract
  for each statement execute function keryx_storage.identity_immutable();
create function keryx_storage.source_contract_insert_guard() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if exists(select 1 from keryx_storage.identity) or exists(select 1 from keryx_storage.enrolled_schema) then
    raise exception 'published source contract is immutable';
  end if;
  return new;
end; $$;
create trigger source_contract_insert_guard before insert on keryx_storage.source_contract
  for each row execute function keryx_storage.source_contract_insert_guard();

create table keryx_storage.enrolled_schema (
  singleton boolean primary key default true check(singleton),
  contract_format text not null check(contract_format='keryx-postgres17-runtime-contract-v1'),
  contract_digest text not null check(contract_digest ~ '^[0-9a-f]{64}$')
);
revoke all on keryx_storage.enrolled_schema from public,anon,authenticated,service_role;
create trigger enrolled_schema_immutable before update or delete on keryx_storage.enrolled_schema
  for each row execute function keryx_storage.identity_immutable();
create trigger enrolled_schema_no_truncate before truncate on keryx_storage.enrolled_schema
  for each statement execute function keryx_storage.identity_immutable();

create table keryx_storage.cache_quota (
  singleton boolean primary key default true check(singleton),
  row_count bigint not null check(row_count between 0 and 512),
  wire_bytes bigint not null check(wire_bytes between 0 and 8388608)
);
revoke all on keryx_storage.cache_quota from public,anon,authenticated,service_role;

-- PostgreSQL17 source-profile material. Only semantic, resolved names are used:
-- no OIDs, transaction IDs, relfilenodes, statistics or mutable table contents.
-- Reference generation is performed on a separate fresh synthetic database,
-- never on an enrollment target. The final reviewed source contract is mandatory
-- before owner cutover is implemented/enabled.
create function keryx_storage.catalog_contract() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $contract$

declare result jsonb; bytes bigint; rows_count bigint;
begin
  if current_setting('server_version_num')::integer/10000<>17 then raise exception 'unsupported schema contract version'; end if;
  if exists(select 1 from pg_namespace where nspname not in ('public','keryx_storage','information_schema')
    and nspname !~ '^pg_') then raise exception 'unsupported schema contract namespace'; end if;
  -- Reviewed migrations do not define foreign objects/custom operator families.
  -- Refuse these rather than silently omitting their security semantics.
  if exists(select 1 from pg_foreign_table f join pg_class c on c.oid=f.ftrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage'))
    or exists(select 1 from pg_operator o join pg_namespace n on n.oid=o.oprnamespace where n.nspname in ('public','keryx_storage'))
    or exists(select 1 from pg_opclass o join pg_namespace n on n.oid=o.opcnamespace where n.nspname in ('public','keryx_storage'))
    or exists(select 1 from pg_opfamily o join pg_namespace n on n.oid=o.opfnamespace where n.nspname in ('public','keryx_storage'))
    or exists(select 1 from pg_conversion o join pg_namespace n on n.oid=o.connamespace where n.nspname in ('public','keryx_storage'))
    or exists(select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage') and t.typtype in ('r','m'))
    then raise exception 'unsupported schema contract object'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','keryx_storage'))>512
    or (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage'))>512
    or (select count(*) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage') and a.attnum>0)>4096
    or (select count(*) from pg_roles)>128 then raise exception 'schema contract count bound'; end if;
  if (select count(*) from (
    select c.oid from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname in ('public','keryx_storage')
    union all select t.oid from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select t.oid from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage')
    union all select p.oid from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select oid from pg_auth_members
    union all select oid from pg_default_acl
    union all select r.oid from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select e.oid from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage')
  ) raw_metadata)>16384 then raise exception 'schema contract count bound'; end if;
  with fields as (
    select octet_length(d.adbin::text) bytes from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    -- Budget encoded trigger arguments at TWO bytes per raw byte, without first
    -- allocating hex text. Qualifier nodes are measured before any deparsing.
    union all select 2::bigint*octet_length(t.tgargs)::bigint+octet_length(coalesce(t.tgqual::text,''))::bigint from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select octet_length(coalesce(x.conbin::text,'')) from pg_constraint x join pg_namespace n on n.oid=x.connamespace where n.nspname in ('public','keryx_storage')
    union all select octet_length(coalesce(c.reloptions::text,''))+octet_length(coalesce(c.relacl::text,'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select octet_length(coalesce(p.polqual::text,''))+octet_length(coalesce(p.polwithcheck::text,'')) from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select octet_length(r.ev_action::text)+octet_length(r.ev_qual::text) from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')
    union all select octet_length(coalesce(r.rolconfig::text,'')) from pg_roles r
    union all select octet_length(coalesce(s.setconfig::text,'')) from pg_db_role_setting s
    union all select octet_length(d.defaclacl::text) from pg_default_acl d
    union all select octet_length(coalesce(t.typdefault,''))+octet_length(coalesce(t.typacl::text,'')) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage')
  ) select count(*),coalesce(sum(fields.bytes),0) into rows_count,bytes from fields having coalesce(max(fields.bytes),0)<=131072;
  if rows_count is null or rows_count>16384 or bytes>8388608 then raise exception 'schema contract raw field bound'; end if;
  -- Raw stored fields are bounded BEFORE pg_get_* deparsing/json aggregation.
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','keryx_storage')
      and (octet_length(p.prosrc)>131072 or octet_length(coalesce(p.probin,''))>131072
        or octet_length(coalesce(p.proconfig::text,''))>131072))
    or (select coalesce(sum(octet_length(p.prosrc)+octet_length(coalesce(p.probin,''))+octet_length(coalesce(p.proconfig::text,''))),0)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','keryx_storage'))>8388608
    then raise exception 'schema contract source bound'; end if;
  -- Each descriptor row is checked before the final aggregate. The second pass is
  -- coherent under the enclosing transaction snapshot; caller must retain that scope.
  with entries as (select 'database' section,value from (select jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,
    'ctype',d.datctype,'localeProvider',d.datlocprovider,'locale',d.datlocale,
    'icuRules',d.daticurules,'collationVersion',d.datcollversion,
    'actualCollationVersion',pg_database_collation_actual_version(d.oid),'allowConnections',d.datallowconn,
    'connectionLimit',d.datconnlimit,'owner',pg_get_userbyid(d.datdba),'acl',jsonb_build_object('explicit',d.datacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) z))) value
    from pg_database d where d.datname=current_database()) d
union all
select 'schemas' section,value from (select jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',jsonb_build_object('explicit',n.nspacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) z))) value
    from pg_namespace n where n.nspname in ('public','keryx_storage')) d
union all
select 'relations' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),'acl',jsonb_build_object('explicit',c.relacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) z)),
    'options',c.reloptions,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
    'replicaIdentity',c.relreplident,'accessMethod',am.amname,'partition',pg_get_expr(c.relpartbound,c.oid),
    'partitionKey',pg_get_partkeydef(c.oid),
    'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end) value
    from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_am am on am.oid=c.relam where n.nspname in ('public','keryx_storage')) d
union all
select 'columns' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',a.attname,
    'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
    'acl',jsonb_build_object('explicit',a.attacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(a.attacl,acldefault('c',c.relowner))) z)),'storage',a.attstorage,'compression',a.attcompression,'options',a.attoptions,
    'collation',case when co.oid is null then null else cn.nspname||'.'||co.collname end) value
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on (d.adrelid,d.adnum)=(a.attrelid,a.attnum)
    left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
    where n.nspname in ('public','keryx_storage') and a.attnum>0 and not a.attisdropped) d
union all
select 'constraints' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',x.conname,
    'type',x.contype,'definition',pg_get_constraintdef(x.oid,false),'validated',x.convalidated,
    'deferrable',x.condeferrable,'initiallyDeferred',x.condeferred,'noInherit',x.connoinherit,
    'parent',px.conname,'referencedSchema',rn.nspname,'referencedRelation',rc.relname) value
    from pg_constraint x join pg_namespace n on n.oid=x.connamespace
    left join pg_class c on c.oid=x.conrelid left join pg_class rc on rc.oid=x.confrelid
    left join pg_namespace rn on rn.oid=rc.relnamespace left join pg_constraint px on px.oid=x.conparentid where n.nspname in ('public','keryx_storage')) d
union all
select 'indexes' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',ic.relname,
    'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,
    'live',i.indislive,'unique',i.indisunique,'nullsNotDistinct',i.indnullsnotdistinct,
    'primary',i.indisprimary,'exclusion',i.indisexclusion,'immediate',i.indimmediate,
    'clustered',i.indisclustered,'replicaIdentity',i.indisreplident) value
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_class ic on ic.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'triggers' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,
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
    left join pg_namespace rn on rn.oid=rc.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'functions' section,value from (select jsonb_build_object('schema',n.nspname,'name',p.proname,'kind',p.prokind,
    'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'definition',case when p.prokind='a' then null else pg_get_functiondef(p.oid) end,
    'source',p.prosrc,'binary',p.probin,'language',l.lanname,'owner',pg_get_userbyid(p.proowner),
    'acl',jsonb_build_object('explicit',p.proacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)),'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,
    'strict',p.proisstrict,'returnsSet',p.proretset,'volatility',p.provolatile,'parallel',p.proparallel,
    'cost',p.procost::text,'rows',p.prorows::text,'settings',p.proconfig,
    'support',case when p.prosupport=0 then null else p.prosupport::regprocedure::text end) value
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in ('public','keryx_storage')) d
union all
select 'policies' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',p.polname,
    'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(
      case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) value
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'defaults' section,value from (select jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,
    'objectType',d.defaclobjtype,'acl',jsonb_build_object('explicit',d.defaclacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(d.defaclacl) z))) value from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace) d
union all
select 'roles' section,value from (select jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,
    'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'login',r.rolcanlogin,
    'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,
    'validUntil',(r.rolvaliduntil at time zone 'UTC')::text,'settings',r.rolconfig) value from pg_roles r) d
union all
select 'memberships' section,value from (select jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
    'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) value from pg_auth_members m) d
union all
select 'roleSettings' section,value from (select jsonb_build_object('role',case when s.setrole=0 then 'ALL' else pg_get_userbyid(s.setrole) end,
    'database',case when s.setdatabase=0 then 'ALL' else 'CURRENT' end,'settings',s.setconfig) value
    from pg_db_role_setting s where s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())) d
union all
select 'inheritance' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'parentSchema',pn.nspname,
    'parent',p.relname,'sequence',i.inhseqno,'detachPending',i.inhdetachpending) value
    from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_class p on p.oid=i.inhparent join pg_namespace pn on pn.oid=p.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'sequenceOwnership' section,value from (select jsonb_build_object('schema',n.nspname,'sequence',s.relname,
    'relationSchema',rn.nspname,'relation',r.relname,'column',a.attname,'dependency',d.deptype) value
    from pg_depend d join pg_class s on d.classid='pg_class'::regclass and d.objid=s.oid and s.relkind='S'
    join pg_namespace n on n.oid=s.relnamespace join pg_class r on d.refclassid='pg_class'::regclass and d.refobjid=r.oid
    join pg_namespace rn on rn.oid=r.relnamespace join pg_attribute a on a.attrelid=r.oid and a.attnum=d.refobjsubid
    where n.nspname in ('public','keryx_storage') and d.deptype in ('a','i')) d
union all
select 'sequences' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.relname,'type',format_type(s.seqtypid,null),
    'start',s.seqstart::text,'increment',s.seqincrement::text,'minimum',s.seqmin::text,
    'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle) value
    from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'types' section,value from (select jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,
    'owner',pg_get_userbyid(t.typowner),'notNull',t.typnotnull,'base',case when t.typbasetype=0 then null else format_type(t.typbasetype,t.typtypmod) end,
    'default',t.typdefault,'acl',jsonb_build_object('explicit',t.typacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) z)),'category',t.typcategory,'preferred',t.typispreferred,
    'delimiter',t.typdelim,'length',t.typlen,'byValue',t.typbyval,'alignment',t.typalign,'storage',t.typstorage,
    'element',case when t.typelem=0 then null else format_type(t.typelem,null) end,
    'input',t.typinput::regprocedure::text,'output',t.typoutput::regprocedure::text,
    'receive',case when t.typreceive=0 then null else t.typreceive::regprocedure::text end,
    'send',case when t.typsend=0 then null else t.typsend::regprocedure::text end,
    'modifierInput',case when t.typmodin=0 then null else t.typmodin::regprocedure::text end,
    'modifierOutput',case when t.typmodout=0 then null else t.typmodout::regprocedure::text end,
    'analyze',case when t.typanalyze=0 then null else t.typanalyze::regprocedure::text end,
    'enum',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) value
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'rules' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',r.rulename,
    'enabled',r.ev_enabled,'definition',pg_get_ruledef(r.oid,false)) value
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'collations' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.collname,'owner',pg_get_userbyid(c.collowner),
    'provider',c.collprovider,'deterministic',c.collisdeterministic,'encoding',c.collencoding,
    'collate',c.collcollate,'ctype',c.collctype,'locale',c.colllocale,'icuRules',c.collicurules,
    'version',c.collversion,'actualVersion',pg_collation_actual_version(c.oid)) value from pg_collation c join pg_namespace n on n.oid=c.collnamespace
    where n.nspname in ('public','keryx_storage') or c.oid in (select a.attcollation from pg_attribute a join pg_class r on r.oid=a.attrelid
      join pg_namespace rn on rn.oid=r.relnamespace where rn.nspname in ('public','keryx_storage'))) d
union all
select 'operations' section,value from (select jsonb_build_object('operation',o.operation,'relations',o.relations,
    'realOnly',o.real_only,'readOnly',o.read_only) value from keryx_storage.operations o) d)
  select count(*),coalesce(sum(octet_length(value::text)),0) into rows_count,bytes from entries
    having coalesce(max(octet_length(value::text)),0)<=131072;
  if rows_count is null or rows_count>16384 or bytes>8388608 then raise exception 'schema contract metadata bound'; end if;
  with entries as (select 'database' section,value from (select jsonb_build_object('encoding',pg_encoding_to_char(d.encoding),'collate',d.datcollate,
    'ctype',d.datctype,'localeProvider',d.datlocprovider,'locale',d.datlocale,
    'icuRules',d.daticurules,'collationVersion',d.datcollversion,
    'actualCollationVersion',pg_database_collation_actual_version(d.oid),'allowConnections',d.datallowconn,
    'connectionLimit',d.datconnlimit,'owner',pg_get_userbyid(d.datdba),'acl',jsonb_build_object('explicit',d.datacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) z))) value
    from pg_database d where d.datname=current_database()) d
union all
select 'schemas' section,value from (select jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'acl',jsonb_build_object('explicit',n.nspacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) z))) value
    from pg_namespace n where n.nspname in ('public','keryx_storage')) d
union all
select 'relations' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,
    'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),'acl',jsonb_build_object('explicit',c.relacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) z)),
    'options',c.reloptions,'rowSecurity',c.relrowsecurity,'forceRowSecurity',c.relforcerowsecurity,
    'replicaIdentity',c.relreplident,'accessMethod',am.amname,'partition',pg_get_expr(c.relpartbound,c.oid),
    'partitionKey',pg_get_partkeydef(c.oid),
    'view',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) else null end) value
    from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_am am on am.oid=c.relam where n.nspname in ('public','keryx_storage')) d
union all
select 'columns' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',a.attname,
    'position',a.attnum,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
    'identity',a.attidentity,'generated',a.attgenerated,'default',pg_get_expr(d.adbin,d.adrelid),
    'acl',jsonb_build_object('explicit',a.attacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(a.attacl,acldefault('c',c.relowner))) z)),'storage',a.attstorage,'compression',a.attcompression,'options',a.attoptions,
    'collation',case when co.oid is null then null else cn.nspname||'.'||co.collname end) value
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on (d.adrelid,d.adnum)=(a.attrelid,a.attnum)
    left join pg_collation co on co.oid=a.attcollation left join pg_namespace cn on cn.oid=co.collnamespace
    where n.nspname in ('public','keryx_storage') and a.attnum>0 and not a.attisdropped) d
union all
select 'constraints' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',x.conname,
    'type',x.contype,'definition',pg_get_constraintdef(x.oid,false),'validated',x.convalidated,
    'deferrable',x.condeferrable,'initiallyDeferred',x.condeferred,'noInherit',x.connoinherit,
    'parent',px.conname,'referencedSchema',rn.nspname,'referencedRelation',rc.relname) value
    from pg_constraint x join pg_namespace n on n.oid=x.connamespace
    left join pg_class c on c.oid=x.conrelid left join pg_class rc on rc.oid=x.confrelid
    left join pg_namespace rn on rn.oid=rc.relnamespace left join pg_constraint px on px.oid=x.conparentid where n.nspname in ('public','keryx_storage')) d
union all
select 'indexes' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',ic.relname,
    'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,
    'live',i.indislive,'unique',i.indisunique,'nullsNotDistinct',i.indnullsnotdistinct,
    'primary',i.indisprimary,'exclusion',i.indisexclusion,'immediate',i.indimmediate,
    'clustered',i.indisclustered,'replicaIdentity',i.indisreplident) value
    from pg_index i join pg_class c on c.oid=i.indrelid join pg_class ic on ic.oid=i.indexrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'triggers' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,
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
    left join pg_namespace rn on rn.oid=rc.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'functions' section,value from (select jsonb_build_object('schema',n.nspname,'name',p.proname,'kind',p.prokind,
    'arguments',pg_get_function_identity_arguments(p.oid),'result',pg_get_function_result(p.oid),
    'definition',case when p.prokind='a' then null else pg_get_functiondef(p.oid) end,
    'source',p.prosrc,'binary',p.probin,'language',l.lanname,'owner',pg_get_userbyid(p.proowner),
    'acl',jsonb_build_object('explicit',p.proacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) z)),'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,
    'strict',p.proisstrict,'returnsSet',p.proretset,'volatility',p.provolatile,'parallel',p.proparallel,
    'cost',p.procost::text,'rows',p.prorows::text,'settings',p.proconfig,
    'support',case when p.prosupport=0 then null else p.prosupport::regprocedure::text end) value
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in ('public','keryx_storage')) d
union all
select 'policies' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',p.polname,
    'command',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(
      case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end order by case when r=0 then 'PUBLIC' else pg_get_userbyid(r) end) from unnest(p.polroles) r),
    'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) value
    from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'defaults' section,value from (select jsonb_build_object('owner',pg_get_userbyid(d.defaclrole),'schema',n.nspname,
    'objectType',d.defaclobjtype,'acl',jsonb_build_object('explicit',d.defaclacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(d.defaclacl) z))) value from pg_default_acl d
    left join pg_namespace n on n.oid=d.defaclnamespace) d
union all
select 'roles' section,value from (select jsonb_build_object('name',r.rolname,'superuser',r.rolsuper,'inherit',r.rolinherit,
    'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'login',r.rolcanlogin,
    'replication',r.rolreplication,'bypassRls',r.rolbypassrls,'connectionLimit',r.rolconnlimit,
    'validUntil',(r.rolvaliduntil at time zone 'UTC')::text,'settings',r.rolconfig) value from pg_roles r) d
union all
select 'memberships' section,value from (select jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
    'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) value from pg_auth_members m) d
union all
select 'roleSettings' section,value from (select jsonb_build_object('role',case when s.setrole=0 then 'ALL' else pg_get_userbyid(s.setrole) end,
    'database',case when s.setdatabase=0 then 'ALL' else 'CURRENT' end,'settings',s.setconfig) value
    from pg_db_role_setting s where s.setdatabase=0 or s.setdatabase=(select oid from pg_database where datname=current_database())) d
union all
select 'inheritance' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'parentSchema',pn.nspname,
    'parent',p.relname,'sequence',i.inhseqno,'detachPending',i.inhdetachpending) value
    from pg_inherits i join pg_class c on c.oid=i.inhrelid join pg_namespace n on n.oid=c.relnamespace
    join pg_class p on p.oid=i.inhparent join pg_namespace pn on pn.oid=p.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'sequenceOwnership' section,value from (select jsonb_build_object('schema',n.nspname,'sequence',s.relname,
    'relationSchema',rn.nspname,'relation',r.relname,'column',a.attname,'dependency',d.deptype) value
    from pg_depend d join pg_class s on d.classid='pg_class'::regclass and d.objid=s.oid and s.relkind='S'
    join pg_namespace n on n.oid=s.relnamespace join pg_class r on d.refclassid='pg_class'::regclass and d.refobjid=r.oid
    join pg_namespace rn on rn.oid=r.relnamespace join pg_attribute a on a.attrelid=r.oid and a.attnum=d.refobjsubid
    where n.nspname in ('public','keryx_storage') and d.deptype in ('a','i')) d
union all
select 'sequences' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.relname,'type',format_type(s.seqtypid,null),
    'start',s.seqstart::text,'increment',s.seqincrement::text,'minimum',s.seqmin::text,
    'maximum',s.seqmax::text,'cache',s.seqcache::text,'cycle',s.seqcycle) value
    from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'types' section,value from (select jsonb_build_object('schema',n.nspname,'name',t.typname,'kind',t.typtype,
    'owner',pg_get_userbyid(t.typowner),'notNull',t.typnotnull,'base',case when t.typbasetype=0 then null else format_type(t.typbasetype,t.typtypmod) end,
    'default',t.typdefault,'acl',jsonb_build_object('explicit',t.typacl is not null,'grants',
    (select coalesce(jsonb_agg(jsonb_build_object('grantor',pg_get_userbyid(z.grantor),
      'grantee',case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,
      'privilege',z.privilege_type,'grantable',z.is_grantable)
      order by pg_get_userbyid(z.grantor),case when z.grantee=0 then 'PUBLIC' else pg_get_userbyid(z.grantee) end,z.privilege_type,z.is_grantable),'[]'::jsonb)
     from aclexplode(coalesce(t.typacl,acldefault('T',t.typowner))) z)),'category',t.typcategory,'preferred',t.typispreferred,
    'delimiter',t.typdelim,'length',t.typlen,'byValue',t.typbyval,'alignment',t.typalign,'storage',t.typstorage,
    'element',case when t.typelem=0 then null else format_type(t.typelem,null) end,
    'input',t.typinput::regprocedure::text,'output',t.typoutput::regprocedure::text,
    'receive',case when t.typreceive=0 then null else t.typreceive::regprocedure::text end,
    'send',case when t.typsend=0 then null else t.typsend::regprocedure::text end,
    'modifierInput',case when t.typmodin=0 then null else t.typmodin::regprocedure::text end,
    'modifierOutput',case when t.typmodout=0 then null else t.typmodout::regprocedure::text end,
    'analyze',case when t.typanalyze=0 then null else t.typanalyze::regprocedure::text end,
    'enum',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) value
    from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'rules' section,value from (select jsonb_build_object('schema',n.nspname,'relation',c.relname,'name',r.rulename,
    'enabled',r.ev_enabled,'definition',pg_get_ruledef(r.oid,false)) value
    from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage')) d
union all
select 'collations' section,value from (select jsonb_build_object('schema',n.nspname,'name',c.collname,'owner',pg_get_userbyid(c.collowner),
    'provider',c.collprovider,'deterministic',c.collisdeterministic,'encoding',c.collencoding,
    'collate',c.collcollate,'ctype',c.collctype,'locale',c.colllocale,'icuRules',c.collicurules,
    'version',c.collversion,'actualVersion',pg_collation_actual_version(c.oid)) value from pg_collation c join pg_namespace n on n.oid=c.collnamespace
    where n.nspname in ('public','keryx_storage') or c.oid in (select a.attcollation from pg_attribute a join pg_class r on r.oid=a.attrelid
      join pg_namespace rn on rn.oid=r.relnamespace where rn.nspname in ('public','keryx_storage'))) d
union all
select 'operations' section,value from (select jsonb_build_object('operation',o.operation,'relations',o.relations,
    'realOnly',o.real_only,'readOnly',o.read_only) value from keryx_storage.operations o) d),
  sections as (select section,jsonb_agg(value order by value::text collate "C") items from entries group by section),
  names(section) as (values ('database'),('schemas'),('relations'),('columns'),('constraints'),('indexes'),('triggers'),('functions'),('policies'),('defaults'),('roles'),('memberships'),('roleSettings'),('inheritance'),('sequenceOwnership'),('sequences'),('types'),('rules'),('collations'),('operations'))
  select jsonb_build_object('format','keryx-postgres17-runtime-contract-v1','major',17,'sections',
    jsonb_object_agg(names.section,coalesce(sections.items,'[]'::jsonb))) into result from names left join sections using(section);
  if octet_length(result::text)>8388608 then raise exception 'schema contract export bound'; end if;
  return result;
end;

$contract$;

create function keryx_storage.verify_cache_quota(p_count bigint,p_bytes bigint) returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare retained keryx_storage.cache_quota%rowtype;
begin
  select * into retained from keryx_storage.cache_quota where singleton;
  if not found or retained.row_count is distinct from p_count or retained.wire_bytes is distinct from p_bytes then
    raise exception 'storage cache quota refused';
  end if;
end; $$;

create function keryx_storage.cache_quota_write() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare retained keryx_storage.cache_quota%rowtype;
  selected_identity jsonb;
  old_count bigint := 0; old_bytes bigint := 0; new_count bigint := 0; new_bytes bigint := 0;
begin
  if tg_op='TRUNCATE' then raise exception 'storage cache truncate refused'; end if;
  -- This same singleton serializes replacements, inserts and deletes; a stale
  -- REPEATABLE READ writer must serialize/refuse rather than overwrite totals.
  select * into retained from keryx_storage.cache_quota where singleton for update;
  if not found then raise exception 'storage cache quota refused'; end if;
  if tg_op in ('UPDATE','DELETE') and old.text is not null then
    old_count := 1; old_bytes := octet_length(old.text);
  end if;
  if tg_op in ('UPDATE','INSERT') and new.text is not null then
    if char_length(new.source_id) not between 1 and 256 or octet_length(new.source_id)>512
      or (select sum(case when ascii(substr(new.source_id,i,1))>65535 then 2 else 1 end)
        from generate_series(1,char_length(new.source_id)) i)>256
      or octet_length(new.text)>2097152 then raise exception 'storage cache quota refused'; end if;
    new_count := 1; new_bytes := octet_length(new.text);
    select identity into selected_identity from keryx_storage.identity where singleton;
    if not found then raise exception 'storage cache identity refused'; end if;
    perform keryx_storage.validate_cache_wire(new.source_id,new.text,selected_identity);
  end if;
  if retained.row_count-old_count+new_count not between 0 and 512
    or retained.wire_bytes-old_bytes+new_bytes not between 0 and 8388608 then
    raise exception 'storage cache quota refused';
  end if;
  update keryx_storage.cache_quota set row_count=retained.row_count-old_count+new_count,
    wire_bytes=retained.wire_bytes-old_bytes+new_bytes where singleton;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;

-- Database structural/context binding only. AES-GCM authentication remains in
-- the private runtime helper with the actual key; service composition is trusted.
create function keryx_storage.validate_cache_wire(p_source_id text,p_text text,p_identity jsonb) returns void
language plpgsql immutable security definer set search_path=pg_catalog,pg_temp as $$
declare wire text; decoded text; envelope jsonb; k text; field text; bytes bytea;
begin
  if p_identity->>'authorityMode'='testnet-offline' then
    if left(p_text,9)<>'plain:v1:' or octet_length(p_text)>1048576+9 then raise exception 'storage cache format refused'; end if;
    return;
  end if;
  if left(p_text,7)<>'enc:v3:' or octet_length(p_text)>2097152 then raise exception 'storage cache format refused'; end if;
  wire := substr(p_text,8);
  if wire !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then raise exception 'storage cache format refused'; end if;
  bytes := decode(wire,'base64');
  if replace(encode(bytes,'base64'),E'\n','')<>wire then raise exception 'storage cache format refused'; end if;
  decoded := convert_from(bytes,'UTF8'); envelope := decoded::jsonb;
  if jsonb_typeof(envelope) is distinct from 'object'
    or public.browser_signing_source_canonical(envelope)<>decoded
    or (select array_agg(key order by key) from jsonb_object_keys(envelope) key)
      is distinct from array['authTagB64','cipherB64','format','ivB64','sourceId','storageIdentityDigest','wrapIvB64','wrappedKeyB64']::text[]
    or envelope->>'format'<>'keryx-enrolled-cache-v1' or envelope->>'sourceId' is distinct from p_source_id
    or envelope->>'storageIdentityDigest' is distinct from keryx_storage.identity_digest(p_identity) then
    raise exception 'storage cache context refused';
  end if;
  foreach k in array array['format','sourceId','storageIdentityDigest','cipherB64','ivB64','authTagB64','wrappedKeyB64','wrapIvB64'] loop
    if jsonb_typeof(envelope->k) is distinct from 'string' then raise exception 'storage cache format refused'; end if;
  end loop;
  foreach k in array array['cipherB64','ivB64','authTagB64','wrappedKeyB64','wrapIvB64'] loop
    field := envelope->>k;
    if field !~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then raise exception 'storage cache format refused'; end if;
    bytes := decode(field,'base64');
    if replace(encode(bytes,'base64'),E'\n','')<>field or
      (k='cipherB64' and octet_length(bytes)>1048576) or
      (k in ('ivB64','wrapIvB64') and octet_length(bytes)<>12) or
      (k='authTagB64' and octet_length(bytes)<>16) or
      (k='wrappedKeyB64' and octet_length(bytes)<>48) then raise exception 'storage cache format refused'; end if;
  end loop;
end; $$;
-- The fixed row-profile guard composes the existing domain constraints.
create function keryx_storage.write_fence() returns trigger
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare active_identity jsonb; scope record; row jsonb;
begin
  select i.identity,o.real_only,o.relations into scope from keryx_storage.writer w
    join keryx_storage.identity i on i.identity_digest=w.identity_digest
    join keryx_storage.operations o on o.operation=w.operation
    where w.transaction_id=txid_current();
  if not found or not tg_table_name=any(scope.relations) then raise exception 'storage authority writer required'; end if;
  active_identity := scope.identity;
  if active_identity->>'authorityMode'='testnet-offline' and scope.real_only then raise exception 'storage authority mode refused'; end if;
  if tg_op='TRUNCATE' then raise exception 'storage authority truncate refused'; end if;
  if tg_op='DELETE' then return old; end if;
  row := to_jsonb(new);
  if row ? 'network' and row->>'network' is distinct from 'eip155:5042002' then raise exception 'storage row network refused'; end if;
  if tg_table_name='payment_events' then
    if active_identity->>'authorityMode'='testnet-offline' and (row->>'settlement_status' is distinct from 'simulated' or (row->>'settled')::boolean) then
      raise exception 'offline financial evidence refused';
    end if;
    if active_identity->>'authorityMode'='testnet-real' and row->>'settlement_status'='simulated' then raise exception 'real store simulated writer refused'; end if;
  elsif tg_table_name='browser_authorization_intents' then
    if lower(row->>'token') is distinct from '0x3600000000000000000000000000000000000000'
      or lower(row->>'gateway_contract') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9' then raise exception 'storage row contract profile refused'; end if;
  elsif tg_table_name='browser_journal_bindings' then
    if row#>>'{requirements,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{requirements,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or row#>>'{requirements,extra,name}' is distinct from 'GatewayWalletBatched'
      or row#>>'{requirements,extra,version}' is distinct from '1'
      or lower(row#>>'{requirements,extra,verifyingContract}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9'
      or row#>>'{payment_metadata,network}' is distinct from 'eip155:5042002' then raise exception 'storage browser binding profile refused'; end if;
  elsif tg_table_name in ('private_creator_submissions','private_creator_confirmations') then
    if row#>>'{data,submission,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{data,submission,asset}') is distinct from '0x3600000000000000000000000000000000000000' then raise exception 'storage private creator profile refused'; end if;
  elsif tg_table_name='private_research_intents' then
    if row#>>'{data,requirement,network}' is distinct from 'eip155:5042002'
      or lower(row#>>'{data,requirement,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or row#>>'{data,requirement,extra,name}' is distinct from 'GatewayWalletBatched'
      or row#>>'{data,requirement,extra,version}' is distinct from '1'
      or lower(row#>>'{data,requirement,extra,verifyingContract}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9' then raise exception 'storage private requirement profile refused'; end if;
  elsif tg_table_name='creator_withdrawal_requests' then
    if row#>>'{data,network}' is distinct from 'eip155:5042002'
      or row#>>'{data,policy,domain}' is distinct from '26'
      or lower(row#>>'{data,policy,asset}') is distinct from '0x3600000000000000000000000000000000000000'
      or lower(row#>>'{data,policy,gatewayWallet}') is distinct from '0x0077777d7eba4688bdef3e311b846f25870a19b9'
      or lower(row#>>'{data,policy,gatewayMinter}') is distinct from '0x0022222abe238cc2c7bb1f21003f0a260052475b' then raise exception 'storage withdrawal profile refused'; end if;
    if row#>>'{data,request,burnIntent,spec,sourceDomain}' is distinct from '26'
      or row#>>'{data,request,burnIntent,spec,destinationDomain}' is distinct from '26'
      or lower(row#>>'{data,request,burnIntent,spec,sourceContract}') is distinct from ('0x'||repeat('0',24)||'0077777d7eba4688bdef3e311b846f25870a19b9')
      or lower(row#>>'{data,request,burnIntent,spec,destinationContract}') is distinct from ('0x'||repeat('0',24)||'0022222abe238cc2c7bb1f21003f0a260052475b')
      or lower(row#>>'{data,request,burnIntent,spec,sourceToken}') is distinct from ('0x'||repeat('0',24)||'3600000000000000000000000000000000000000')
      or lower(row#>>'{data,request,burnIntent,spec,destinationToken}') is distinct from ('0x'||repeat('0',24)||'3600000000000000000000000000000000000000') then raise exception 'storage withdrawal burn profile refused'; end if;
  end if;
  return new;
end; $$;

-- Owner-only fixed installation primitive. Reference generation invokes this on
-- a separate empty source database. Runtime enrollment first validates its PRE
-- source contract/CAS; application roles cannot execute it independently.
create function keryx_storage.install_fixed_fences() returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare relation record; column_row record; f record; retained_count bigint; retained_bytes bigint;
begin
  if current_setting('statement_timeout')::interval<=interval '0'
    or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded owner statement deadline required';
  end if;
  perform pg_advisory_xact_lock(634781904177021::bigint);
  if exists(select 1 from keryx_storage.identity) then raise exception 'already enrolled store'; end if;
  for relation in select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace
    and c.relkind in ('r','p') order by c.relname loop
    execute format('lock table public.%I in share row exclusive mode',relation.relname);
  end loop;
  select count(*),coalesce(sum(octet_length(text)),0) into retained_count,retained_bytes
    from public.cache_items where text is not null;
  if retained_count>512 or retained_bytes>8388608 or exists(select 1 from public.cache_items
    where text is not null and (octet_length(text)>2097152 or octet_length(source_id)>512)) then
    raise exception 'storage cache quota refused';
  end if;
  if exists(select 1 from keryx_storage.cache_quota) then raise exception 'cache quota already initialized'; end if;
  insert into keryx_storage.cache_quota values(true,retained_count,retained_bytes);
  for relation in select c.oid,c.relname from pg_class c where c.relnamespace='public'::regnamespace
    and c.relkind in ('r','p') order by c.relname loop
    execute format('revoke all on table public.%I from public,anon,authenticated,service_role',relation.relname);
    for column_row in select attname from pg_attribute where attrelid=relation.oid and attnum>0 and not attisdropped loop
      execute format('revoke all(%I) on table public.%I from public,anon,authenticated,service_role',column_row.attname,relation.relname);
    end loop;
    execute format('create trigger storage_authority_writer before insert or update or delete on public.%I for each row execute function keryx_storage.write_fence()',relation.relname);
    execute format('create trigger storage_authority_no_truncate before truncate on public.%I for each statement execute function keryx_storage.write_fence()',relation.relname);
  end loop;
  -- AFTER avoids double-counting speculative INSERT before ON CONFLICT UPDATE.
  -- A rejected quota update still rolls back the complete public-row mutation.
  create trigger storage_cache_quota after insert or update or delete on public.cache_items
    for each row execute function keryx_storage.cache_quota_write();
  revoke all on all sequences in schema public from public,anon,authenticated,service_role;
  revoke create on schema public from public,anon,authenticated,service_role;
  alter default privileges in schema public revoke all on tables from public,anon,authenticated,service_role;
  alter default privileges in schema public revoke all on sequences from public,anon,authenticated,service_role;
  alter default privileges in schema public revoke execute on functions from public,anon,authenticated,service_role;
  for f in select p.oid::regprocedure signature,p.proname from pg_proc p
    where p.pronamespace='public'::regnamespace and p.prokind='f' order by p.proname,p.oid loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    if f.proname='read_storage_identity' or f.proname like 'storage\_%' escape '\' then
      execute 'grant execute on function '||f.signature||' to service_role';
    else
      -- Explicit pg_temp LAST protects existing invoker/definer domain bodies
      -- from temporary relation shadowing after the owner-only ACL cutover.
      execute 'alter function '||f.signature||' set search_path to pg_catalog,public,pg_temp';
    end if;
  end loop;
end; $$;

create function keryx_storage.snapshot_digest() returns text
language plpgsql security definer set search_path=pg_catalog,pg_temp
set lock_timeout='5s'
set datestyle='ISO, YMD' set timezone='UTC' set extra_float_digits=3 set bytea_output='hex' as $$
declare snapshot_table record; count_rows bigint; total_rows bigint := 0; total_bytes numeric := 0; row_bytes numeric; max_row_bytes integer; deadline timestamptz := clock_timestamp()+interval '30 seconds'; rows_digest text; manifest text := ''; catalog_digest text;
begin
  if current_setting('statement_timeout')::interval<=interval '0' or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded owner statement deadline required';
  end if;
  if exists(select 1 from public.cache_items where text is not null and (octet_length(text)>2097152 or octet_length(source_id)>512)) then raise exception 'complete provenance cache bytes exceed approved bounds'; end if;
  perform pg_advisory_xact_lock(634781904177021::bigint);
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('f','m')
    and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema') then
    raise exception 'unsupported foreign/materialized provenance requires separate inspection';
  end if;
  for snapshot_table in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
      and not (n.nspname='keryx_storage' and c.relname='identity') order by n.nspname,c.relname loop
    execute format('lock table %I.%I in share row exclusive mode',snapshot_table.nspname,snapshot_table.relname);
  end loop;
  for snapshot_table in select n.nspname,c.relname,c.oid from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
      and not (n.nspname='keryx_storage' and c.relname='identity') order by n.nspname,c.relname loop
    execute format('select count(*) from %I.%I',snapshot_table.nspname,snapshot_table.relname) into count_rows;
    if clock_timestamp()>deadline then raise exception 'complete provenance deadline exceeded'; end if;
    total_rows := total_rows + count_rows;
    execute format('select coalesce(sum(octet_length(record_send(r))),0),coalesce(max(octet_length(record_send(r))),0) from %I.%I r',snapshot_table.nspname,snapshot_table.relname) into row_bytes,max_row_bytes;
    total_bytes := total_bytes+row_bytes;
    if max_row_bytes>(case when snapshot_table.nspname='public' and snapshot_table.relname='cache_items' then 2097152+8192 else 1048576 end) or total_bytes>67108864 then raise exception 'complete provenance native bytes exceed approved bounds'; end if;
    if total_rows>200000 then raise exception 'complete provenance snapshot exceeds approved bounds'; end if;
    execute format($query$select encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex')
      from (select encode(sha256(record_send(r)),'hex') h from %I.%I r) rows$query$,snapshot_table.nspname,snapshot_table.relname) into rows_digest;
    manifest := manifest || quote_ident(snapshot_table.nspname)||'.'||quote_ident(snapshot_table.relname)||':'||count_rows||':'||rows_digest||E'\n';
  end loop;
  for snapshot_table in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='S' and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema' order by n.nspname,c.relname loop
    execute format('select encode(sha256(record_send(r)),''hex'') from %I.%I r',snapshot_table.nspname,snapshot_table.relname) into rows_digest;
    manifest := manifest || 'sequence:'||quote_ident(snapshot_table.nspname)||'.'||quote_ident(snapshot_table.relname)||':'||rows_digest||E'\n';
  end loop;
  -- Full schema/ACL/ownership/collation/role membership is part of the same CAS.
  -- Catalog record text uses PostgreSQL native escaped field representation;
  -- some catalog pseudo-types have no binary send function. Secrets in
  -- pg_authid/passwords are deliberately not read.
  select encode(sha256(convert_to(coalesce(string_agg(piece,E'\n' order by piece),''),'UTF8')),'hex') into catalog_digest from (
    select 'namespace:'||encode(sha256(convert_to(n::text,'UTF8')),'hex') piece from pg_namespace n where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'relation:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'column:'||encode(sha256(convert_to(a::text,'UTF8')),'hex') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'constraint:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'trigger:'||encode(sha256(convert_to(t::text,'UTF8')),'hex') from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'function:'||pg_get_functiondef(p.oid)||':'||coalesce(p.proacl::text,'')||':'||p.proowner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'policy:'||encode(sha256(convert_to(p::text,'UTF8')),'hex') from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'type:'||encode(sha256(convert_to(t::text,'UTF8')),'hex') from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'enum:'||encode(sha256(convert_to(e::text,'UTF8')),'hex') from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'collation:'||encode(sha256(convert_to(c::text,'UTF8')),'hex') from pg_collation c
    union all select 'index:'||encode(sha256(convert_to(i::text,'UTF8')),'hex') from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'default:'||encode(sha256(convert_to(d::text,'UTF8')),'hex') from pg_attrdef d join pg_class c on c.oid=d.adrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'rule:'||encode(sha256(convert_to(r::text,'UTF8')),'hex') from pg_rewrite r join pg_class c on c.oid=r.ev_class join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'sequence-definition:'||encode(sha256(convert_to(s::text,'UTF8')),'hex') from pg_sequence s join pg_class c on c.oid=s.seqrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg\_%' escape '\' and n.nspname<>'information_schema'
    union all select 'extension:'||encode(sha256(convert_to(e::text,'UTF8')),'hex') from pg_extension e
    union all select 'grant-default:'||encode(sha256(convert_to(d::text,'UTF8')),'hex') from pg_default_acl d
    union all select 'role:'||encode(sha256(convert_to(r::text,'UTF8')),'hex') from pg_roles r
    union all select 'membership:'||encode(sha256(convert_to(m::text,'UTF8')),'hex') from pg_auth_members m
  ) pieces;
  return encode(sha256(convert_to('keryx-postgres-provenance-v1'||E'\n'||manifest||catalog_digest,'UTF8')),'hex');
end; $$;


create function keryx_storage.require_source_contract(p_phase text) returns text
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare actual jsonb; expected jsonb; section_row record; reference text; digest_count bigint;
  retained_rows bigint; retained_bytes bigint;
begin
  if p_phase not in ('before','after') or p_phase is null then raise exception 'source contract refused'; end if;
  select count(*),coalesce(sum(octet_length(value::text)),0) into retained_rows,retained_bytes
    from keryx_storage.source_contract where phase=p_phase;
  if retained_rows>16384 or retained_bytes>8388608 then raise exception 'source contract bound exceeded'; end if;
  select count(distinct reference_digest),min(reference_digest) into digest_count,reference
    from keryx_storage.source_contract where phase=p_phase;
  if digest_count<>1 or reference is null then raise exception 'reviewed source contract required'; end if;
  if exists(select 1 from keryx_storage.source_contract r where r.phase=p_phase and r.ordinal>=0
    and not exists(select 1 from keryx_storage.source_contract header
      where header.phase=r.phase and header.section=r.section and header.ordinal=-1)) then
    raise exception 'source contract refused';
  end if;
  select jsonb_build_object('format','keryx-postgres17-runtime-contract-v1','major',17,'sections',
    jsonb_object_agg(section,items)) into expected from (
      select section,coalesce(jsonb_agg(value order by ordinal) filter(where ordinal>=0),'[]'::jsonb) items
      from keryx_storage.source_contract where phase=p_phase group by section
    ) sections;
  if encode(sha256(convert_to(public.browser_signing_source_canonical(expected),'UTF8')),'hex') is distinct from reference then
    raise exception 'source contract digest mismatch';
  end if;
  actual := keryx_storage.catalog_contract();
  if actual->>'format' is distinct from expected->>'format' or actual->'major' is distinct from expected->'major'
    or (select array_agg(key order by key) from jsonb_object_keys(actual->'sections') key)
      is distinct from (select array_agg(key order by key) from jsonb_object_keys(expected->'sections') key) then
    raise exception 'unsupported source schema contract';
  end if;
  -- Section rows are multisets of exact jsonb objects. Preserve duplicate counts
  -- and nested array semantics without assuming jsonb::text equals JS canonical JSON.
  for section_row in select key,value from jsonb_each(expected->'sections') loop
    if exists(select 1 from (
      (select value from jsonb_array_elements(actual->'sections'->section_row.key)
        except all select value from jsonb_array_elements(section_row.value))
      union all
      (select value from jsonb_array_elements(section_row.value)
        except all select value from jsonb_array_elements(actual->'sections'->section_row.key))
    ) differences) then raise exception 'unsupported source schema contract'; end if;
  end loop;
  return reference;
end; $$;

create function keryx_storage.verify_fences() returns void
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare reference text; retained keryx_storage.enrolled_schema%rowtype;
begin
  reference := keryx_storage.require_source_contract('after');
  select * into retained from keryx_storage.enrolled_schema where singleton;
  if not found or retained.contract_digest is distinct from reference then raise exception 'storage schema readiness refused'; end if;
  if not exists(select 1 from keryx_storage.cache_quota where singleton) then raise exception 'storage cache quota refused'; end if;
  if exists(select 1 from keryx_storage.writer) or exists(select 1 from public.browser_journal_writer)
    or exists(select 1 from public.browser_signing_v2_writer) or exists(select 1 from public.browser_signing_v3_writer) then
    raise exception 'retained writer capability refused';
  end if;
end; $$;

create function keryx_storage.enroll(p_identity jsonb,p_reviewed_snapshot_digest text) returns void
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare original keryx_storage.identity%rowtype; selected_digest text; source_digest text;
  legacy_table record; has_legacy_rows boolean; cache_row record;
begin
  if current_setting('statement_timeout')::interval<=interval '0'
    or current_setting('statement_timeout')::interval>interval '30 seconds' then
    raise exception 'bounded owner statement deadline required';
  end if;
  perform keryx_storage.validate_identity(p_identity);
  if p_reviewed_snapshot_digest is null or p_reviewed_snapshot_digest !~ '^[0-9a-f]{64}$' then raise exception 'reviewed provenance required'; end if;
  perform pg_advisory_xact_lock(634781904177021::bigint);
  select * into original from keryx_storage.identity where singleton for update;
  if found then
    if original.identity is distinct from p_identity or original.enrolled_snapshot_digest is distinct from p_reviewed_snapshot_digest then
      raise exception 'conflicting enrollment refused';
    end if;
    perform keryx_storage.verify_fences();
    return;
  end if;
  perform keryx_storage.require_source_contract('before');
  selected_digest := keryx_storage.snapshot_digest();
  if selected_digest<>p_reviewed_snapshot_digest then raise exception 'provenance changed after inspection'; end if;
  -- This first supported owner cutover cannot legitimize existing authentication,
  -- grants, originals or funded treasury history by merely relabeling the store.
  if exists(select 1 from public.session_grants) or exists(select 1 from public.browser_authorization_intents)
    or exists(select 1 from public.browser_retained_grants) or exists(select 1 from public.browser_signer_capacity)
    or exists(select 1 from public.browser_signing_namespaces) or exists(select 1 from public.browser_signing_queries)
    or exists(select 1 from public.browser_signing_policies) or exists(select 1 from public.browser_signing_originals)
    or exists(select 1 from public.web_sessions) or exists(select 1 from public.auth_challenges)
    or exists(select 1 from public.api_keys) or exists(select 1 from public.creator_withdrawal_requests)
    or exists(select 1 from public.a2a_orders) or exists(select 1 from public.withdrawals) then
    raise exception 'legacy authority requires separate quarantine/recovery';
  end if;
  for legacy_table in select c.relname from pg_class c where c.relnamespace='public'::regnamespace
    and c.relkind in ('r','p') and c.relname like 'private\_%' escape '\' order by c.relname loop
    execute format('select exists(select 1 from public.%I)',legacy_table.relname) into has_legacy_rows;
    if has_legacy_rows then raise exception 'legacy authority requires separate quarantine/recovery'; end if;
  end loop;
  if exists(select 1 from public.payment_events where settled or settlement_status is distinct from 'simulated'
    or authorization_id is not null or authorization_phase is not null or grant_epoch is not null
    or amount_usdc<0 or amount_usdc::text in ('NaN','Infinity','-Infinity')
    or amount_usdc*1000000<>trunc(amount_usdc*1000000) or network is distinct from 'eip155:5042002') then
    raise exception 'legacy financial authority requires separate quarantine/recovery';
  end if;
  for cache_row in select source_id,text from public.cache_items where text is not null order by source_id loop
    perform keryx_storage.validate_cache_wire(cache_row.source_id,cache_row.text,p_identity);
  end loop;
  perform keryx_storage.install_fixed_fences();
  source_digest := keryx_storage.require_source_contract('after');
  insert into keryx_storage.enrolled_schema values(true,'keryx-postgres17-runtime-contract-v1',source_digest);
  insert into keryx_storage.identity values(true,p_identity,keryx_storage.identity_digest(p_identity),selected_digest);
  perform keryx_storage.verify_fences();
end; $$;

revoke all on all functions in schema keryx_storage from public,anon,authenticated,service_role;
commit;
