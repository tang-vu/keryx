-- Dormant fixed domain APIs. Legacy tables/RPC privileges are unchanged at installation.
-- Every API refuses until explicit owner cutover has verified and enrolled the store.
begin;
-- Fixed domain operations; no runtime SQL/table selector. Installed before final ACL cutover.

create function public.storage_get_supabase_withdrawal_attestation(p_expected_identity jsonb,p_id public."creator_withdrawal_attestations"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_withdrawal_attestation');

  select (select to_jsonb(r) from (select "claim_id","transfer_id","data","saved_at" from public."creator_withdrawal_attestations" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_withdrawal_request(p_expected_identity jsonb,p_id public."creator_withdrawal_requests"."id"%TYPE,p_owner public."creator_withdrawal_requests"."owner"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_withdrawal_request');

  select (select to_jsonb(r) from (select "data" from public."creator_withdrawal_requests" where "id" = p_id and "owner" = p_owner) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_withdrawal_transfer_claim(p_expected_identity jsonb,p_id public."creator_withdrawal_transfer_attempts"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_withdrawal_transfer_claim');

  select (select to_jsonb(r) from (select "claim_id","started_at" from public."creator_withdrawal_transfer_attempts" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_creator_confirmation(p_expected_identity jsonb,p_authorization_id public."private_creator_confirmations"."authorization_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_creator_confirmation');

  select (select to_jsonb(r) from (select "data","settled_at" from public."private_creator_confirmations" where "authorization_id" = p_authorization_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_list_supabase_private_creator_submissions(p_expected_identity jsonb,p_job_id public."private_creator_submissions"."job_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_supabase_private_creator_submissions');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "leg_id","worker_id","authorization_id","amount_micros","data","started_at" from public."private_creator_submissions" where "job_id" = p_job_id order by "started_at" asc,"leg_id" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_execution(p_expected_identity jsonb,p_id public."private_research_executions"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_execution');

  select (select to_jsonb(r) from (select "worker_id","started_at" from public."private_research_executions" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_research_intent(p_expected_identity jsonb,p_id public."private_research_intents"."id"%TYPE,p_payer public."private_research_intents"."payer"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_research_intent');

  select (select to_jsonb(r) from (select "data" from public."private_research_intents" where "id" = p_id and "payer" = p_payer) r) into result;
  
  return result;
end;
$$;

create function public.storage_reserve_supabase_private_research_intent(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'reserve_supabase_private_research_intent');

  insert into public."private_research_intents"("id","payer","data") select "id","payer","data" from jsonb_populate_recordset(null::public."private_research_intents",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do nothing; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_supabase_private_interruption(p_expected_identity jsonb,p_id public."private_research_interruptions"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_interruption');

  select (select to_jsonb(r) from (select "worker_id","reason","recorded_at" from public."private_research_interruptions" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_payment(p_expected_identity jsonb,p_id public."private_research_payment_attempts"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_payment');

  select (select to_jsonb(r) from (select "started_at","confirmation","settled_at" from public."private_research_payment_attempts" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_result(p_expected_identity jsonb,p_id public."private_research_results"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_result');

  select (select to_jsonb(r) from (select "serialized_run","saved_at" from public."private_research_results" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_supabase_private_treasury(p_expected_identity jsonb,p_job_id public."private_treasury_reservations"."job_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_supabase_private_treasury');

  select (select to_jsonb(r) from (select "signer","amount_micros" from public."private_treasury_reservations" where "job_id" = p_job_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_reserve_supabase_private_treasury(p_expected_identity jsonb,p_job_id public."private_treasury_reservations"."job_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'reserve_supabase_private_treasury');

  select (select to_jsonb(r) from (select "signer","amount_micros" from public."private_treasury_reservations" where "job_id" = p_job_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_release_supabase_private_treasury(p_expected_identity jsonb,p_job_id public."private_treasury_releases"."job_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'release_supabase_private_treasury');

  select (select to_jsonb(r) from (select "amount_micros" from public."private_treasury_releases" where "job_id" = p_job_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_upsert_source(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'upsert_source');

  insert into public."sources"("id","name","url","description","rss_url","wallet_address","fetch_price","tags","authors","created_at","ipfs_cid","active","verified","preview_depth","onchain_id","register_tx") select "id","name","url","description","rss_url","wallet_address","fetch_price","tags","authors","created_at","ipfs_cid","active","verified","preview_depth","onchain_id","register_tx" from jsonb_populate_recordset(null::public."sources",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "name"=excluded."name","url"=excluded."url","description"=excluded."description","rss_url"=excluded."rss_url","wallet_address"=excluded."wallet_address","fetch_price"=excluded."fetch_price","tags"=excluded."tags","authors"=excluded."authors","created_at"=excluded."created_at","ipfs_cid"=excluded."ipfs_cid","active"=excluded."active","verified"=excluded."verified","preview_depth"=excluded."preview_depth","onchain_id"=excluded."onchain_id","register_tx"=excluded."register_tx"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_sources(p_expected_identity jsonb,p_active public."sources"."active"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_sources');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."sources" where "active" = p_active order by "created_at" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_all_sources(p_expected_identity jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_all_sources');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."sources" order by "created_at" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_set_source_meta(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_source_meta');

  insert into public."source_meta"("id","name","description","url","rss_url","updated_at") select "id","name","description","url","rss_url","updated_at" from jsonb_populate_recordset(null::public."source_meta",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "name"=excluded."name","description"=excluded."description","url"=excluded."url","rss_url"=excluded."rss_url","updated_at"=excluded."updated_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_source_meta(p_expected_identity jsonb,p_id public."source_meta"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_source_meta');

  select (select to_jsonb(r) from (select "name","description","url","rss_url" from public."source_meta" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_set_source_notify(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_source_notify');

  insert into public."source_notify"("source_id","notify_url","secret","updated_at") select "source_id","notify_url","secret","updated_at" from jsonb_populate_recordset(null::public."source_notify",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("source_id") do update set "notify_url"=excluded."notify_url","secret"=excluded."secret","updated_at"=excluded."updated_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_source_notify(p_expected_identity jsonb,p_source_id public."source_notify"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_source_notify');

  select (select to_jsonb(r) from (select "notify_url","secret" from public."source_notify" where "source_id" = p_source_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_delete_source_notify(p_expected_identity jsonb,p_source_id public."source_notify"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_source_notify');

  delete from public."source_notify" where "source_id" = p_source_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_set_source_notify_email(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_source_notify_email');

  insert into public."source_notify_email"("source_id","email","unsub_token","last_sent_at","updated_at") select "source_id","email","unsub_token","last_sent_at","updated_at" from jsonb_populate_recordset(null::public."source_notify_email",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("source_id") do update set "email"=excluded."email","unsub_token"=excluded."unsub_token","last_sent_at"=excluded."last_sent_at","updated_at"=excluded."updated_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_source_notify_email(p_expected_identity jsonb,p_source_id public."source_notify_email"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_source_notify_email');

  select (select to_jsonb(r) from (select "email","unsub_token","last_sent_at" from public."source_notify_email" where "source_id" = p_source_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_delete_source_notify_email(p_expected_identity jsonb,p_source_id public."source_notify_email"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_source_notify_email');

  delete from public."source_notify_email" where "source_id" = p_source_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_mark_source_notify_email_sent(p_expected_identity jsonb,p_row jsonb,p_source_id public."source_notify_email"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'mark_source_notify_email_sent');

  update public."source_notify_email" set "last_sent_at"=(jsonb_populate_record(null::public."source_notify_email",p_row))."last_sent_at" where "source_id" = p_source_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_set_source_preview_depth(p_expected_identity jsonb,p_row jsonb,p_id public."sources"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_source_preview_depth');

  update public."sources" set "preview_depth"=(jsonb_populate_record(null::public."sources",p_row))."preview_depth" where "id" = p_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_source(p_expected_identity jsonb,p_id public."sources"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_source');

  select (select to_jsonb(r) from (select * from public."sources" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_source_by_onchain_id(p_expected_identity jsonb,p_onchain_id public."sources"."onchain_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_source_by_onchain_id');

  select (select to_jsonb(r) from (select * from public."sources" where "onchain_id" ilike p_onchain_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_add_items(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'add_items');

  insert into public."source_items"("id","source_id","title","summary","content","link","published_at","ipfs_cid","item_key_enc","item_iv","item_auth_tag","item_wrap_iv","delivery_kind","storage_mode","plaintext_bytes","body_hash","manifest_id","manifest_signer","manifest_nonce","manifest_signature","manifest_created_at") select "id","source_id","title","summary","content","link","published_at","ipfs_cid","item_key_enc","item_iv","item_auth_tag","item_wrap_iv","delivery_kind","storage_mode","plaintext_bytes","body_hash","manifest_id","manifest_signer","manifest_nonce","manifest_signature","manifest_created_at" from jsonb_populate_recordset(null::public."source_items",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "source_id"=excluded."source_id","title"=excluded."title","summary"=excluded."summary","content"=excluded."content","link"=excluded."link","published_at"=excluded."published_at","ipfs_cid"=excluded."ipfs_cid","item_key_enc"=excluded."item_key_enc","item_iv"=excluded."item_iv","item_auth_tag"=excluded."item_auth_tag","item_wrap_iv"=excluded."item_wrap_iv","delivery_kind"=excluded."delivery_kind","storage_mode"=excluded."storage_mode","plaintext_bytes"=excluded."plaintext_bytes","body_hash"=excluded."body_hash","manifest_id"=excluded."manifest_id","manifest_signer"=excluded."manifest_signer","manifest_nonce"=excluded."manifest_nonce","manifest_signature"=excluded."manifest_signature","manifest_created_at"=excluded."manifest_created_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_items(p_expected_identity jsonb,p_source_id public."source_items"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_items');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."source_items" where "source_id" = p_source_id order by "published_at" desc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_get_item(p_expected_identity jsonb,p_source_id public."source_items"."source_id"%TYPE,p_id public."source_items"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_item');

  select (select to_jsonb(r) from (select * from public."source_items" where "source_id" = p_source_id and "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_article_offer(p_expected_identity jsonb,p_source_id public."article_offers"."source_id"%TYPE,p_item_id public."article_offers"."item_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_article_offer');

  select (select to_jsonb(r) from (select * from public."article_offers" where "source_id" = p_source_id and "item_id" = p_item_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_set_article_offer(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_article_offer');

  insert into public."article_offers"("source_id","item_id","id","content_version","price_usdc6","expires_at","signer","nonce","signature","created_at") select "source_id","item_id","id","content_version","price_usdc6","expires_at","signer","nonce","signature","created_at" from jsonb_populate_recordset(null::public."article_offers",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("source_id","item_id") do update set "id"=excluded."id","content_version"=excluded."content_version","price_usdc6"=excluded."price_usdc6","expires_at"=excluded."expires_at","signer"=excluded."signer","nonce"=excluded."nonce","signature"=excluded."signature","created_at"=excluded."created_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_delete_article_offer(p_expected_identity jsonb,p_source_id public."article_offers"."source_id"%TYPE,p_item_id public."article_offers"."item_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_article_offer');

  delete from public."article_offers" where "source_id" = p_source_id and "item_id" = p_item_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_count_items_published_between(p_expected_identity jsonb,p_source_id text[],p_published_at public."source_items"."published_at"%TYPE,p_published_at_2 public."source_items"."published_at"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'count_items_published_between');
  if p_source_id is null or cardinality(p_source_id)>1000 then raise exception 'invalid bounded selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "source_id" from public."source_items" where "source_id"=any(p_source_id) and "published_at" > p_published_at and "published_at" <= p_published_at_2 limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_newest_item_dates(p_expected_identity jsonb,p_source_id text[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'newest_item_dates');
  if p_source_id is null or cardinality(p_source_id)>1000 then raise exception 'invalid bounded selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "source_id","published_at" from public."source_items" where "source_id"=any(p_source_id) and "published_at" is not null order by "published_at" desc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_gap_intents(p_expected_identity jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_gap_intents');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."gap_intents" order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_finish_gap_intent(p_expected_identity jsonb,p_row jsonb,p_id public."gap_intents"."id"%TYPE,p_status public."gap_intents"."status"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'finish_gap_intent');

  with changed as (update public."gap_intents" set "status"=(jsonb_populate_record(null::public."gap_intents",p_row))."status","retry_run_id"=(jsonb_populate_record(null::public."gap_intents",p_row))."retry_run_id","coverage"=(jsonb_populate_record(null::public."gap_intents",p_row))."coverage","reward_usdc"=(jsonb_populate_record(null::public."gap_intents",p_row))."reward_usdc","last_error"=(jsonb_populate_record(null::public."gap_intents",p_row))."last_error","lease_expires_at"=(jsonb_populate_record(null::public."gap_intents",p_row))."lease_expires_at","updated_at"=(jsonb_populate_record(null::public."gap_intents",p_row))."updated_at" where "id" = p_id and "status" = p_status returning "id") select (select to_jsonb(r) from changed r) into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_expire_gap_intent(p_expected_identity jsonb,p_row jsonb,p_id public."gap_intents"."id"%TYPE,p_status public."gap_intents"."status"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'expire_gap_intent');

  update public."gap_intents" set "status"=(jsonb_populate_record(null::public."gap_intents",p_row))."status","last_error"=(jsonb_populate_record(null::public."gap_intents",p_row))."last_error","lease_expires_at"=(jsonb_populate_record(null::public."gap_intents",p_row))."lease_expires_at","updated_at"=(jsonb_populate_record(null::public."gap_intents",p_row))."updated_at" where "id" = p_id and "status" = p_status; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_is_creator_wallet(p_expected_identity jsonb,p_wallet_address public."sources"."wallet_address"%TYPE,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'is_creator_wallet');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select (select to_jsonb(r) from (select "id" from public."sources" where "wallet_address" ilike p_wallet_address limit p_limit) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_web_session(p_expected_identity jsonb,p_hash public."web_sessions"."hash"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_web_session');

  select (select to_jsonb(r) from (select "hash","wallet","issued_at","expires_at" from public."web_sessions" where "hash" = p_hash) r) into result;
  
  return result;
end;
$$;

create function public.storage_revoke_web_session(p_expected_identity jsonb,p_hash public."web_sessions"."hash"%TYPE,p_wallet public."web_sessions"."wallet"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'revoke_web_session');

  delete from public."web_sessions" where "hash" = p_hash and "wallet" = p_wallet; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_web_sessions(p_expected_identity jsonb,p_wallet public."web_sessions"."wallet"%TYPE,p_issued_at public."web_sessions"."issued_at"%TYPE,p_expires_at public."web_sessions"."expires_at"%TYPE,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_web_sessions');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "hash","wallet","issued_at","expires_at" from public."web_sessions" where "wallet" = p_wallet and "issued_at" <= p_issued_at and "expires_at" > p_expires_at order by "issued_at" desc,"hash" asc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_revoke_other_web_sessions(p_expected_identity jsonb,p_wallet public."web_sessions"."wallet"%TYPE,p_hash public."web_sessions"."hash"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'revoke_other_web_sessions');

  delete from public."web_sessions" where "wallet" = p_wallet and "hash" <> p_hash; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_upsert_user(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'upsert_user');

  insert into public."users"("wallet_address","role","display_handle","first_seen_at","last_seen_at") select "wallet_address","role","display_handle","first_seen_at","last_seen_at" from jsonb_populate_recordset(null::public."users",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("wallet_address") do update set "role"=excluded."role","display_handle"=excluded."display_handle","first_seen_at"=excluded."first_seen_at","last_seen_at"=excluded."last_seen_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_user(p_expected_identity jsonb,p_wallet_address public."users"."wallet_address"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_user');

  select (select to_jsonb(r) from (select * from public."users" where "wallet_address" ilike p_wallet_address) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_cached(p_expected_identity jsonb,p_source_id public."cache_items"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_cached');

  select (select to_jsonb(r) from (select "text" from public."cache_items" where "source_id" = p_source_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_cached_at(p_expected_identity jsonb,p_source_id public."cache_items"."source_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_cached_at');

  select (select to_jsonb(r) from (select "updated_at" from public."cache_items" where "source_id" = p_source_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_set_cached(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_cached');

  insert into public."cache_items"("source_id","text","updated_at") select "source_id","text","updated_at" from jsonb_populate_recordset(null::public."cache_items",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("source_id") do update set "text"=excluded."text","updated_at"=excluded."updated_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_save_query_run(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'save_query_run');

  insert into public."query_runs"("id","created_at","question","budget","engine","total_spent","total_to_creators","answer","data","parent_id","asker","origin","mcp_client","duration_ms","payment_mode","payment_attempts","settled_payments","confidence_level","evidence_claim_count","grounded_claim_count","rewarded_citation_count","economics_data") select "id","created_at","question","budget","engine","total_spent","total_to_creators","answer","data","parent_id","asker","origin","mcp_client","duration_ms","payment_mode","payment_attempts","settled_payments","confidence_level","evidence_claim_count","grounded_claim_count","rewarded_citation_count","economics_data" from jsonb_populate_recordset(null::public."query_runs",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "created_at"=excluded."created_at","question"=excluded."question","budget"=excluded."budget","engine"=excluded."engine","total_spent"=excluded."total_spent","total_to_creators"=excluded."total_to_creators","answer"=excluded."answer","data"=excluded."data","parent_id"=excluded."parent_id","asker"=excluded."asker","origin"=excluded."origin","mcp_client"=excluded."mcp_client","duration_ms"=excluded."duration_ms","payment_mode"=excluded."payment_mode","payment_attempts"=excluded."payment_attempts","settled_payments"=excluded."settled_payments","confidence_level"=excluded."confidence_level","evidence_claim_count"=excluded."evidence_claim_count","grounded_claim_count"=excluded."grounded_claim_count","rewarded_citation_count"=excluded."rewarded_citation_count","economics_data"=excluded."economics_data"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_follow_ups(p_expected_identity jsonb,p_parent_id public."query_runs"."parent_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_follow_ups');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "data" from public."query_runs" where "parent_id" = p_parent_id order by "created_at" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_query_runs_by_asker(p_expected_identity jsonb,p_asker public."query_runs"."asker"%TYPE,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_query_runs_by_asker');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "data" from public."query_runs" where "asker" = p_asker order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_get_query_run(p_expected_identity jsonb,p_id public."query_runs"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_query_run');

  select (select to_jsonb(r) from (select "data" from public."query_runs" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_list_recent_queries(p_expected_identity jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_recent_queries');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "data" from public."query_runs" order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_record_payment(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'record_payment');

  insert into public."payment_events"("id","created_at","kind","query_id","source_id","source_name","payer","payee","amount_usdc","weight","rationale","tx_hash","network","settled","settlement_status","authorization_id","authorization_expires_at","grant_epoch","origin","item_id","item_title","item_url","content_version","item_published_at","offer_id","list_price_usdc") select "id","created_at","kind","query_id","source_id","source_name","payer","payee","amount_usdc","weight","rationale","tx_hash","network","settled","settlement_status","authorization_id","authorization_expires_at","grant_epoch","origin","item_id","item_title","item_url","content_version","item_published_at","offer_id","list_price_usdc" from jsonb_populate_recordset(null::public."payment_events",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end); result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_record_payment_once(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'record_payment_once');

  with changed as (insert into public."payment_events"("id","created_at","kind","query_id","source_id","source_name","payer","payee","amount_usdc","weight","rationale","tx_hash","network","settled","settlement_status","authorization_id","authorization_expires_at","grant_epoch","origin") select "id","created_at","kind","query_id","source_id","source_name","payer","payee","amount_usdc","weight","rationale","tx_hash","network","settled","settlement_status","authorization_id","authorization_expires_at","grant_epoch","origin" from jsonb_populate_recordset(null::public."payment_events",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do nothing returning "id") select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from changed r into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_create_a2a_order(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'create_a2a_order');

  with changed as (insert into public."a2a_orders"("id","query_id","authorization_id","request_hash","payer","payee","amount_usdc","creator_budget_usdc","service_fee_usdc","research_mode","package_data","status","transaction_id","request_data","started_at","worker_id","execution_journal_version","payment_started_at","result_saving_at","response_data","error_code","resolution_data","created_at","updated_at") select "id","query_id","authorization_id","request_hash","payer","payee","amount_usdc","creator_budget_usdc","service_fee_usdc","research_mode","package_data","status","transaction_id","request_data","started_at","worker_id","execution_journal_version","payment_started_at","result_saving_at","response_data","error_code","resolution_data","created_at","updated_at" from jsonb_populate_recordset(null::public."a2a_orders",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) returning *) select (select to_jsonb(r) from changed r) into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_create_a2a_order_2(p_expected_identity jsonb,p_id public."a2a_orders"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'create_a2a_order_2');

  select (select to_jsonb(r) from (select * from public."a2a_orders" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_get_a2a_order(p_expected_identity jsonb,p_id public."a2a_orders"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_a2a_order');

  select (select to_jsonb(r) from (select * from public."a2a_orders" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_complete_a2a_order(p_expected_identity jsonb,p_row jsonb,p_id public."a2a_orders"."id"%TYPE,p_status public."a2a_orders"."status"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'complete_a2a_order');

  with changed as (update public."a2a_orders" set "status"=(jsonb_populate_record(null::public."a2a_orders",p_row))."status","response_data"=(jsonb_populate_record(null::public."a2a_orders",p_row))."response_data","error_code"=(jsonb_populate_record(null::public."a2a_orders",p_row))."error_code","updated_at"=(jsonb_populate_record(null::public."a2a_orders",p_row))."updated_at" where "id" = p_id and "status" = p_status returning "id") select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from changed r into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_fail_a2a_order(p_expected_identity jsonb,p_row jsonb,p_id public."a2a_orders"."id"%TYPE,p_status public."a2a_orders"."status"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'fail_a2a_order');

  with changed as (update public."a2a_orders" set "status"=(jsonb_populate_record(null::public."a2a_orders",p_row))."status","error_code"=(jsonb_populate_record(null::public."a2a_orders",p_row))."error_code","updated_at"=(jsonb_populate_record(null::public."a2a_orders",p_row))."updated_at" where "id" = p_id and "status" = p_status returning "id") select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from changed r into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_payments(p_expected_identity jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_payments');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."payment_events" where (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed')) order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_activation_funnel(p_expected_identity jsonb,p_day public."activation_events"."day"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'activation_funnel');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "event","count" from public."activation_events" where "day" >= p_day limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_pending_payments(p_expected_identity jsonb,p_settlement_status public."payment_events"."settlement_status"%TYPE,p_settled public."payment_events"."settled"%TYPE,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_pending_payments');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."payment_events" where (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed')) and "settlement_status" = p_settlement_status and "settled" = p_settled and "authorization_id" is not null order by "created_at" asc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_settle_pending_payment(p_expected_identity jsonb,p_row jsonb,p_id public."payment_events"."id"%TYPE,p_authorization_id public."payment_events"."authorization_id"%TYPE,p_settled public."payment_events"."settled"%TYPE,p_settlement_status public."payment_events"."settlement_status"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'settle_pending_payment');

  with changed as (update public."payment_events" set "settled"=(jsonb_populate_record(null::public."payment_events",p_row))."settled","settlement_status"=(jsonb_populate_record(null::public."payment_events",p_row))."settlement_status","tx_hash"=(jsonb_populate_record(null::public."payment_events",p_row))."tx_hash" where "id" = p_id and "authorization_id" = p_authorization_id and "settled" = p_settled and "settlement_status" = p_settlement_status returning "id") select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from changed r into result;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_payments_by_query(p_expected_identity jsonb,p_query_id public."payment_events"."query_id"%TYPE,p_kind public."payment_events"."kind"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_payments_by_query');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."payment_events" where (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed')) and "query_id" = p_query_id and "kind" = p_kind order by "created_at" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_creator_payment_attempts_by_query(p_expected_identity jsonb,p_query_id public."payment_events"."query_id"%TYPE,p_kind public."payment_events"."kind"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_creator_payment_attempts_by_query');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."payment_events" where (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed')) and "query_id" = p_query_id and "kind" <> p_kind order by "created_at" asc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_payments_by_source(p_expected_identity jsonb,p_source_id public."payment_events"."source_id"%TYPE,p_kind public."payment_events"."kind"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_payments_by_source');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."payment_events" where (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed')) and "source_id" = p_source_id and "kind" <> p_kind order by "created_at" desc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_daily_settled(p_expected_identity jsonb,p_settled public."payment_events"."settled"%TYPE,p_created_at public."payment_events"."created_at"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'daily_settled');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "created_at","amount_usdc" from public."payment_events" where "settled" = p_settled and "created_at" >= p_created_at limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_list_withdrawals(p_expected_identity jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_withdrawals');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."withdrawals" order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_settlement_ledger(p_expected_identity jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'settlement_ledger');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "payee","source_name","amount_usdc","kind","settled" from public."payment_events" limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_settlement_ledger_2(p_expected_identity jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'settlement_ledger_2');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "wallet","amount_usdc" from public."withdrawals" limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_get_sync_state(p_expected_identity jsonb,p_key public."sync_state"."key"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_sync_state');

  select (select to_jsonb(r) from (select "value" from public."sync_state" where "key" = p_key) r) into result;
  
  return result;
end;
$$;

create function public.storage_set_sync_state(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'set_sync_state');

  insert into public."sync_state"("key","value","updated_at") select "key","value","updated_at" from jsonb_populate_recordset(null::public."sync_state",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("key") do update set "value"=excluded."value","updated_at"=excluded."updated_at"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_upsert_session_grant(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'upsert_session_grant');

  insert into public."session_grants"("session_id","sess_addr","owner_addr","cap","spent","expiry","tx_hash","grant_epoch") select "session_id","sess_addr","owner_addr","cap","spent","expiry","tx_hash","grant_epoch" from jsonb_populate_recordset(null::public."session_grants",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("session_id") do update set "sess_addr"=excluded."sess_addr","owner_addr"=excluded."owner_addr","cap"=excluded."cap","spent"=excluded."spent","expiry"=excluded."expiry","tx_hash"=excluded."tx_hash","grant_epoch"=excluded."grant_epoch"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_session_grant(p_expected_identity jsonb,p_session_id public."session_grants"."session_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_session_grant');

  select (select to_jsonb(r) from (select * from public."session_grants" where "session_id" = p_session_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_browser_journal_active(p_expected_identity jsonb,p_id public."browser_journal_control"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'browser_journal_active');

  select (select to_jsonb(r) from (select "active" from public."browser_journal_control" where "id" = p_id) r) into result;
  
  return result;
end;
$$;

create function public.storage_delete_session_grant(p_expected_identity jsonb,p_session_id public."session_grants"."session_id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_session_grant');

  delete from public."session_grants" where "session_id" = p_session_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_delete_expired_session_grants(p_expected_identity jsonb,p_expiry public."session_grants"."expiry"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_expired_session_grants');

  delete from public."session_grants" where "expiry" <= p_expiry; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_delete_expired_rate_limits(p_expected_identity jsonb,p_reset_at public."rate_limit_counters"."reset_at"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'delete_expired_rate_limits');

  delete from public."rate_limit_counters" where "reset_at" <= p_reset_at; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_clear_reasoning_circuit(p_expected_identity jsonb,p_key public."reasoning_circuits"."key"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.enter_operation(p_expected_identity,'clear_reasoning_circuit');

  delete from public."reasoning_circuits" where "key" = p_key; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_mint_api_key(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'mint_api_key');

  insert into public."api_keys"("id","prefix","key_hash","wallet","label","created_at","scopes","source_ids") select "id","prefix","key_hash","wallet","label","created_at","scopes","source_ids" from jsonb_populate_recordset(null::public."api_keys",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end); result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_verify_api_key(p_expected_identity jsonb,p_prefix public."api_keys"."prefix"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'verify_api_key');

  select (select to_jsonb(r) from (select "id","key_hash","wallet","scopes","source_ids" from public."api_keys" where "prefix" = p_prefix and "revoked_at" is null) r) into result;
  
  return result;
end;
$$;

create function public.storage_verify_api_key_2(p_expected_identity jsonb,p_row jsonb,p_id public."api_keys"."id"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'verify_api_key_2');

  update public."api_keys" set "last_used_at"=(jsonb_populate_record(null::public."api_keys",p_row))."last_used_at" where "id" = p_id; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_list_api_keys(p_expected_identity jsonb,p_wallet public."api_keys"."wallet"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_api_keys');

  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "id","prefix","wallet","label","created_at","last_used_at","revoked_at","scopes","source_ids" from public."api_keys" where "wallet" = p_wallet order by "created_at" desc limit 1001) r into result;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  
  return result;
end;
$$;

create function public.storage_revoke_api_key(p_expected_identity jsonb,p_row jsonb,p_id public."api_keys"."id"%TYPE,p_wallet public."api_keys"."wallet"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'revoke_api_key');

  update public."api_keys" set "revoked_at"=(jsonb_populate_record(null::public."api_keys",p_row))."revoked_at" where "id" = p_id and "wallet" = p_wallet and "revoked_at" is null; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_get_usage(p_expected_identity jsonb,p_key_id public."api_key_usage"."key_id"%TYPE,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_usage');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select "day","call_count" from public."api_key_usage" where "key_id" = p_key_id order by "day" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_save_query_memory(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'save_query_memory');

  insert into public."query_memories"("id","source_scores","sources_read","topics","created_at") select "id","source_scores","sources_read","topics","created_at" from jsonb_populate_recordset(null::public."query_memories",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end); result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_load_query_memories(p_expected_identity jsonb,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'load_query_memories');
  if p_limit is null or p_limit<0 or p_limit>1000 then raise exception 'invalid bounded limit'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (select * from public."query_memories" order by "created_at" desc limit p_limit) r into result;
  
  return result;
end;
$$;

create function public.storage_record_feedback(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'record_feedback');

  insert into public."answer_feedback"("id","query_id","rating","comment","created_at") select "id","query_id","rating","comment","created_at" from jsonb_populate_recordset(null::public."answer_feedback",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end); result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_record_supabase_withdrawal(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'record_supabase_withdrawal');

  insert into public."withdrawals"("tx_hash","created_at","label","source_name","wallet","recipient","amount_usdc","network") select "tx_hash","created_at","label","source_name","wallet","recipient","amount_usdc","network" from jsonb_populate_recordset(null::public."withdrawals",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("tx_hash") do nothing; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create function public.storage_record_supabase_withdrawal_2(p_expected_identity jsonb,p_tx_hash public."withdrawals"."tx_hash"%TYPE) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'record_supabase_withdrawal_2');

  select (select to_jsonb(r) from (select * from public."withdrawals" where "tx_hash" = p_tx_hash) r) into result;
  
  return result;
end;
$$;





create function public.storage_list_article_offers(p_expected_identity jsonb,p_source_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_article_offers');
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select * from public.article_offers where p_source_id is null or source_id=p_source_id order by created_at desc limit 1001) r;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  return result;
end; $$;
create function public.storage_a2a_operations_snapshot(p_expected_identity jsonb,p_since timestamptz) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'a2a_operations_snapshot');
  if p_since is null then raise exception 'invalid snapshot window'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select status,created_at,updated_at,started_at from public.a2a_orders where status='running' or updated_at>=p_since limit 1001) r;
  if jsonb_array_length(result)>1000 then raise exception 'complete domain result exceeds approved bounds'; end if;
  return result;
end; $$;
create function public.storage_get_feedback_stats(p_expected_identity jsonb,p_query_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'get_feedback_stats');
  select jsonb_build_object('total',count(*),'up',count(*) filter(where rating='up'),
    'down',count(*) filter(where rating='down')) into result from public.answer_feedback
    where p_query_id is null or query_id=p_query_id;
  return result;
end; $$;
create function public.storage_list_creator_withdrawal_history(p_expected_identity jsonb,p_owner text,p_before_time timestamptz,p_before_id text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_creator_withdrawal_history');
  if p_limit is null or p_limit<2 or p_limit>26 or p_owner is null
    or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid history selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,owner,created_at,data from public.creator_withdrawal_requests where owner=p_owner
      and (p_before_time is null or (created_at,id)<(p_before_time,p_before_id)) order by created_at desc,id desc limit p_limit) r;
  return result;
end; $$;
create function public.storage_list_private_research_history(p_expected_identity jsonb,p_owner text,p_before_time timestamptz,p_before_id text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'list_private_research_history');
  if p_owner is null or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid history selection'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,data,created_at from public.private_research_intents where payer=p_owner
      and (p_before_time is null or (created_at,id)<(p_before_time,p_before_id)) order by created_at desc,id desc limit 26) r;
  return result;
end; $$;
create function public.storage_iterate_recent_queries(p_expected_identity jsonb,p_before_time timestamptz,p_before_id text,p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'iterate_recent_queries');
  if p_limit is null or p_limit<1 or p_limit>32 or (p_before_time is null)<>(p_before_id is null) then raise exception 'invalid query cursor'; end if;
  select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
    (select id,created_at,data from public.query_runs
      where p_before_time is null or (created_at,id)<(p_before_time,p_before_id) order by created_at desc,id desc limit p_limit) r;
  return result;
end; $$;

-- Owner installation generates five fixed domain scans; no runtime selector exists.
do $$ declare item record; begin
  for item in select * from (values
    ('scan_payment_metrics','payment_events','id'),
    ('scan_query_metrics','query_runs','id'),('scan_feedback_metrics','answer_feedback','id'),
    ('scan_gap_metrics','gap_intents','id'),('scan_order_economics','a2a_orders','id')) as x(operation,relation,sort_key) loop
    execute format($fn$create function public.storage_%I(p_expected_identity jsonb,p_offset integer,p_limit integer) returns jsonb
      language plpgsql security definer set search_path=pg_catalog,pg_temp as $body$
      declare result jsonb; begin
        perform keryx_storage.read_operation(p_expected_identity,%L);
        if p_offset is null or p_offset<0 or p_offset>200000 or p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'invalid complete scan bounds'; end if;
        select coalesce(jsonb_agg(to_jsonb(r)),'[]') into result from
          (select * from public.%I order by %I limit p_limit offset p_offset) r;
        return result;
      end; $body$;$fn$,item.operation,item.operation,item.relation,item.sort_key);
  end loop;
end; $$;



-- Internal source-context catalog, captured before registry IO. One guarded
-- snapshot improves source/item/offer coherence; admission still rechecks its
-- original five-second deadline and financial authority after all locks.
create function public.storage_read_browser_source_catalog(p_expected_identity jsonb,p_source_id text,p_item_id text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb; raw_bytes bigint; tags jsonb; authors jsonb;
begin
  perform keryx_storage.read_operation(p_expected_identity,'read_browser_source_catalog');
  if p_source_id is null or p_item_id is null or octet_length(p_source_id) not between 1 and 128
    or octet_length(p_item_id) not between 1 and 128 then raise exception 'browser source catalog refused'; end if;
  -- Stored JSONB compression size is not an expanded-size proof. Refuse
  -- compressed legacy metadata without rewriting it; all text sizes below use
  -- TOAST raw-length metadata before any row JSON serialization.
  if exists(select 1 from public.sources s where s.id=p_source_id and
    (pg_column_compression(s.tags) is not null or pg_column_compression(s.authors) is not null))
    then raise exception 'browser source catalog compressed metadata refused'; end if;
  select coalesce(sum(bytes),0) into raw_bytes from (
    select coalesce(octet_length(s.id),0)::bigint+coalesce(octet_length(s.name),0)::bigint+coalesce(octet_length(s.url),0)::bigint+coalesce(octet_length(s.description),0)::bigint+coalesce(octet_length(s.rss_url),0)::bigint+coalesce(octet_length(s.wallet_address),0)::bigint+coalesce(octet_length(s.ipfs_cid),0)::bigint+coalesce(octet_length(s.onchain_id),0)::bigint+coalesce(octet_length(s.register_tx),0)::bigint+coalesce(octet_length(s.preview_depth),0)::bigint+pg_column_size(s.tags)::bigint+pg_column_size(s.authors)::bigint bytes from public.sources s where s.id=p_source_id
    union all select coalesce(octet_length(i.id),0)::bigint+coalesce(octet_length(i.source_id),0)::bigint+coalesce(octet_length(i.title),0)::bigint+coalesce(octet_length(i.summary),0)::bigint+coalesce(octet_length(i.content),0)::bigint+coalesce(octet_length(i.link),0)::bigint+coalesce(octet_length(i.published_at),0)::bigint+coalesce(octet_length(i.ipfs_cid),0)::bigint+coalesce(octet_length(i.item_key_enc),0)::bigint+coalesce(octet_length(i.item_iv),0)::bigint+coalesce(octet_length(i.item_auth_tag),0)::bigint+coalesce(octet_length(i.item_wrap_iv),0)::bigint+coalesce(octet_length(i.delivery_kind),0)::bigint+coalesce(octet_length(i.storage_mode),0)::bigint+coalesce(octet_length(i.body_hash),0)::bigint+coalesce(octet_length(i.manifest_id),0)::bigint+coalesce(octet_length(i.manifest_signer),0)::bigint+coalesce(octet_length(i.manifest_nonce),0)::bigint+coalesce(octet_length(i.manifest_signature),0)::bigint from public.source_items i where i.source_id=p_source_id and i.id=p_item_id
    union all select coalesce(octet_length(o.source_id),0)::bigint+coalesce(octet_length(o.item_id),0)::bigint+coalesce(octet_length(o.id),0)::bigint+coalesce(octet_length(o.content_version),0)::bigint+coalesce(octet_length(o.signer),0)::bigint+coalesce(octet_length(o.nonce),0)::bigint+coalesce(octet_length(o.signature),0)::bigint from public.article_offers o where o.source_id=p_source_id and o.item_id=p_item_id
  ) sizes;
  if raw_bytes>2097152 then raise exception 'browser source catalog bound exceeded'; end if;
  select s.tags,s.authors into tags,authors from public.sources s where s.id=p_source_id;
  if found then
    if jsonb_typeof(tags) is distinct from 'array' or jsonb_typeof(authors) is distinct from 'array'
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if jsonb_array_length(tags)>64 or jsonb_array_length(authors)>64
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if exists(select 1 from jsonb_array_elements(tags) t(value) where jsonb_typeof(value) is distinct from 'string')
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if exists(select 1 from jsonb_array_elements(tags) t(value) where octet_length(value#>>'{}')>512)
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if exists(select 1 from jsonb_array_elements(authors) a(value) where jsonb_typeof(value) is distinct from 'object')
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if exists(select 1 from jsonb_array_elements(authors) a(value) where
      (select array_agg(key order by key) from jsonb_object_keys(value) key) is distinct from array['name','splitWeight','walletAddress']::text[]
      or jsonb_typeof(value->'name') is distinct from 'string'
      or jsonb_typeof(value->'walletAddress') is distinct from 'string'
      or jsonb_typeof(value->'splitWeight') is distinct from 'number'
      or not jsonb_path_exists(value,'$ ? (@.splitWeight >= 0 && @.splitWeight <= 1)'))
      then raise exception 'browser source catalog metadata shape refused'; end if;
    -- Separate statements: SQL boolean qualifier order is not a type fence.
    -- Only proven strings reach scalar text extraction.
    if exists(select 1 from jsonb_array_elements(authors) a(value) where
      octet_length(value->>'name')>1024 or octet_length(value->>'walletAddress')>256)
      then raise exception 'browser source catalog metadata shape refused'; end if;
    if exists(select 1 from public.sources s where s.id=p_source_id and
      (s.fetch_price<0 or s.fetch_price>9007199254.740991)) then raise exception 'browser source catalog price refused'; end if;
    -- PG numeric's maximum fractional scale is 16383. Each validated [0,1]
    -- weight therefore needs at most 16400 output bytes even when its compact
    -- binary value is tiny. Text escaping is at most six bytes per raw byte;
    -- fixed framing/scalars (including bounded fetch_price) fit 64KiB.
    -- Bound SQL intermediate JSON work to 16MiB; returned wire stays <=4MiB.
    if raw_bytes*6+jsonb_array_length(authors)::bigint*16400+65536>16777216
      then raise exception 'browser source catalog bound exceeded'; end if;
  end if;
  select jsonb_build_object(
    'source',(select to_jsonb(s) from public.sources s where s.id=p_source_id),
    'item',(select to_jsonb(i) from public.source_items i where i.source_id=p_source_id and i.id=p_item_id),
    'offer',(select to_jsonb(o) from public.article_offers o where o.source_id=p_source_id and o.item_id=p_item_id)) into result;
  if octet_length(result::text)>4194304 then raise exception 'browser source catalog bound exceeded'; end if;
  return result;
end; $$;

-- Only these newly installed APIs are granted; do not alter legacy function ACLs.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname like 'storage\_%' escape '\' loop
    execute 'revoke all on function '||f.signature||' from public,anon,authenticated,service_role';
    execute 'grant execute on function '||f.signature||' to service_role';
  end loop;
end; $$;
commit;
