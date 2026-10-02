begin;
alter table public.sources add column if not exists evidence_provenance text check(evidence_provenance is null or evidence_provenance='synthetic-demo');
alter table public.source_items add column if not exists evidence_provenance text check(evidence_provenance is null or evidence_provenance='synthetic-demo');
UPDATE source_items SET evidence_provenance='synthetic-demo'
    WHERE evidence_provenance IS NULL AND ((title='Why USDC settles instantly onchain' AND summary='USDC transfers settle in seconds with finality on most L2s.' AND link='https://example.com/stablecoin-ledger/usdc-settles' AND
      (content='USDC is a fully-reserved dollar stablecoin that settles peer-to-peer onchain in seconds. Because settlement is final and programmable, it removes the multi-day delays of card networks and ACH. For machine-to-machine commerce, instant final settlement means an agent can pay and immediately receive a resource without counterparty risk.' OR body_hash='0x2fb6fd0547a5a7e989938282a23d02678de46036d966d3285d126c5808ffd726')) OR
(title='Stablecoins as the unit of account for agents' AND summary='Dollar-denominated stablecoins give agents a stable budget unit.' AND link='https://example.com/stablecoin-ledger/unit-of-account' AND
      (content='Autonomous agents need a stable unit of account to reason about budgets. A volatile token makes ''spend at most $0.05'' meaningless minute to minute. Dollar stablecoins like USDC let an agent price expected value against cost in stable terms, which is a precondition for rational spending decisions.' OR body_hash='0x41af54cfa023a1958be86375b3a5607587bbd6a35c6ba7bd99699c2c30e1c608')) OR
(title='x402 turns HTTP 402 into an agent payment rail' AND summary='The x402 standard lets a server demand payment and an agent pay inline.' AND link='https://example.com/agent-economy/x402-rail' AND
      (content='x402 revives the dormant HTTP 402 ''Payment Required'' status as a real payment rail. A server responds 402 with machine-readable payment requirements; the client signs a payment authorization and retries. Agents can therefore pay per request with no accounts or API keys, discovering and purchasing data autonomously at runtime.' OR body_hash='0x144314817c58b1f8aa3c6528e18b9abec1a6843b8a78d99740275d0753510d18')) OR
(title='Budgets make agents decide, not just automate' AND summary='A spending cap forces an agent to weigh value against price.' AND link='https://example.com/agent-economy/budgets' AND
      (content='An agent under a hard budget must choose: which sources are worth paying for, when a cheaper source suffices, and when it has read enough to stop. This turns automation into genuine agency — every purchase is a reasoned trade-off, and the budget produces emergent frugality.' OR body_hash='0x0f7bce2143d69d4022692f48abefea7b68df4a22c4167f29cd049b7de4465bf9')) OR
(title='Nanopayments and the $0.000001 floor' AND summary='Batched settlement drops the economical floor to a millionth of a dollar.' AND link='https://example.com/micropayments/nano-floor' AND
      (content='Nanopayments push the minimum economical payment to about $0.000001 by signing off-chain authorizations and settling them in batches. Instead of paying gas per transaction, many micro-authorizations settle together. This makes paying a creator a fraction of a cent per citation actually viable.' OR body_hash='0x6aacadc61a72c99b264589eae5eb7f872dff229eb35373ef45f52a848d5f2b35')) OR
(title='Per-citation payments weighted by contribution' AND summary='Reward sources in proportion to how much they grounded an answer.' AND link='https://example.com/micropayments/weighted' AND
      (content='A fair model pays each cited source in proportion to its contribution to the final answer. Heavily-relied-upon sources earn more; lightly-used ones earn less. Weighted nanopayments make this granular settlement practical, and multi-author works can split a single reward across contributors automatically.' OR body_hash='0xbaa0e2ba9f88c60731145239afe052bf972bae06d6cebe2daa507b997501df05')) OR
(title='Idempotency keys prevent double-spends' AND summary='Use a unique key per operation to make retries safe.' AND link='https://example.com/distsys/idempotency' AND
      (content='An idempotency key ensures a retried request is processed at most once. In a payment system, keying on (payer, resource, nonce) prevents charging twice when a client retries after a timeout. This is essential when an autonomous agent issues many rapid payments.' OR body_hash='0x394681bf32b539b9dec4ad6d772ce8194a347cd6a1bf7d9bd1d0184b1360413a')) OR
(title='Building a no-dig raised bed' AND summary='Layer cardboard, compost, and mulch for a low-effort bed.' AND link='https://example.com/garden/no-dig' AND
      (content='A no-dig raised bed starts with cardboard to smother weeds, topped with compost and mulch. Over a season the layers break down into rich soil without tilling, preserving soil structure and the fungal networks plants rely on.' OR body_hash='0xabf2d4bd94d806003243675495703ce6dfbe4d6996be9b15e7c5b06ca32ad702')) OR
(title='Recapping a 1990s console' AND summary='Replace aged electrolytic capacitors to fix video and audio faults.' AND link='https://example.com/retro/recap' AND
      (content='Aged electrolytic capacitors leak and cause dim video or distorted audio on vintage consoles. Recapping — desoldering the old caps and fitting fresh ones of the correct value and voltage — restores the original signal quality and prevents board corrosion.' OR body_hash='0x777c46339ad28a74db564e03e5315a71c6cae8f3dc1716e8030b049172aed513')) OR
(title='Measuring x402 settlement latency on Arc' AND summary='Benchmark methodology and results for x402 batched-settlement finality on Arc testnet.' AND link='https://example.com/arc-benchmarks/x402-latency' AND
      (content='Across thousands of submitBatch calls on Arc testnet, x402 batched settlements finalize in roughly 180 milliseconds (measured median 178ms, p95 240ms). Arc''s BFT consensus delivers sub-second finality, so a Gateway-batched payment confirms in well under a quarter second — it is not block-time-bound the way an Ethereum L1 transaction is.' OR body_hash='0xcc0a59349dd16c44993ebde44eb13d211f1a4528f95a69294c56a89c523de62a')) OR
(title='How long do x402 payments take to finalize?' AND summary='An overview of end-to-end settlement timing for x402 and similar payment rails.' AND link='https://example.com/web-payments-review/x402-timing' AND
      (content='In our reading, an x402 payment takes about 15 seconds to settle, similar to an Ethereum L1 block time, because each payment is its own transaction waiting to be mined into a block. On that view, agent-to-agent micropayments remain sluggish until block times shrink.' OR body_hash='0xd0863ebe78f5c1a920bbe987b119e10bd9a0eedcf5446ebca809a1e88517c4b3')));
    UPDATE sources SET evidence_provenance='synthetic-demo' WHERE evidence_provenance IS NULL
      AND EXISTS (SELECT 1 FROM source_items i WHERE i.source_id=sources.id)
      AND NOT EXISTS (SELECT 1 FROM source_items i WHERE i.source_id=sources.id AND
        (i.evidence_provenance IS NULL OR i.evidence_provenance<>'synthetic-demo'));

-- Only server/operator storage writes are permitted by existing RLS and domain ownership.
-- Sticky provenance survives old writers and registry refreshes. Items inherit source provenance.
create function public.preserve_evidence_provenance() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if TG_OP='UPDATE' and old.evidence_provenance is not null then new.evidence_provenance:=old.evidence_provenance; end if;
  if TG_TABLE_NAME='source_items' then
    new.evidence_provenance:=coalesce(new.evidence_provenance,(select evidence_provenance from public.sources where id=new.source_id));
  end if;
  return new;
end;
$$;
revoke all on function public.preserve_evidence_provenance() from public,anon,authenticated;
create trigger preserve_source_evidence_provenance before insert or update on public.sources for each row execute function public.preserve_evidence_provenance();
create trigger preserve_item_evidence_provenance before insert or update on public.source_items for each row execute function public.preserve_evidence_provenance();

create or replace function public.storage_upsert_source(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'upsert_source');

  insert into public."sources"("id","name","url","description","rss_url","wallet_address","fetch_price","tags","authors","created_at","ipfs_cid","active","verified","preview_depth","onchain_id","register_tx","evidence_provenance") select "id","name","url","description","rss_url","wallet_address","fetch_price","tags","authors","created_at","ipfs_cid","active","verified","preview_depth","onchain_id","register_tx","evidence_provenance" from jsonb_populate_recordset(null::public."sources",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "name"=excluded."name","url"=excluded."url","description"=excluded."description","rss_url"=excluded."rss_url","wallet_address"=excluded."wallet_address","fetch_price"=excluded."fetch_price","tags"=excluded."tags","authors"=excluded."authors","created_at"=excluded."created_at","ipfs_cid"=excluded."ipfs_cid","active"=excluded."active","verified"=excluded."verified","preview_depth"=excluded."preview_depth","onchain_id"=excluded."onchain_id","register_tx"=excluded."register_tx","evidence_provenance"=excluded."evidence_provenance"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

create or replace function public.storage_add_items(p_expected_identity jsonb,p_row jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_row is null or jsonb_typeof(p_row) not in ('object','array') or (jsonb_typeof(p_row)='array' and jsonb_array_length(p_row)>1000) then raise exception 'bounded domain row input required'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'add_items');

  insert into public."source_items"("id","source_id","title","summary","content","link","published_at","ipfs_cid","item_key_enc","item_iv","item_auth_tag","item_wrap_iv","delivery_kind","storage_mode","plaintext_bytes","body_hash","manifest_id","manifest_signer","manifest_nonce","manifest_signature","manifest_created_at","evidence_provenance") select "id","source_id","title","summary","content","link","published_at","ipfs_cid","item_key_enc","item_iv","item_auth_tag","item_wrap_iv","delivery_kind","storage_mode","plaintext_bytes","body_hash","manifest_id","manifest_signer","manifest_nonce","manifest_signature","manifest_created_at","evidence_provenance" from jsonb_populate_recordset(null::public."source_items",case when jsonb_typeof(p_row)='array' then p_row else jsonb_build_array(p_row) end) on conflict("id") do update set "source_id"=excluded."source_id","title"=excluded."title","summary"=excluded."summary","content"=excluded."content","link"=excluded."link","published_at"=excluded."published_at","ipfs_cid"=excluded."ipfs_cid","item_key_enc"=excluded."item_key_enc","item_iv"=excluded."item_iv","item_auth_tag"=excluded."item_auth_tag","item_wrap_iv"=excluded."item_wrap_iv","delivery_kind"=excluded."delivery_kind","storage_mode"=excluded."storage_mode","plaintext_bytes"=excluded."plaintext_bytes","body_hash"=excluded."body_hash","manifest_id"=excluded."manifest_id","manifest_signer"=excluded."manifest_signer","manifest_nonce"=excluded."manifest_nonce","manifest_signature"=excluded."manifest_signature","manifest_created_at"=excluded."manifest_created_at","evidence_provenance"=excluded."evidence_provenance"; result := null;
  perform keryx_storage.leave_operation();
  return result;
end;
$$;

insert into keryx_storage.operations(operation,relations,real_only,read_only)
values('read_evidence_provenance',array['sources','source_items']::text[],false,true);
create function public.storage_read_evidence_provenance(p_expected_identity jsonb,p_source_ids text[],p_item_ids text[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare result jsonb;
begin
  if p_source_ids is null or p_item_ids is null or cardinality(p_source_ids)>500 or cardinality(p_item_ids)>500
    or exists(select 1 from unnest(p_source_ids||p_item_ids) value where value is null or octet_length(value)>1024)
    then raise exception 'bounded provenance identities required'; end if;
  perform keryx_storage.read_operation(p_expected_identity,'read_evidence_provenance');
  select coalesce(jsonb_agg(flag),'[]'::jsonb) into result from (
    select 'source:'||id flag from public.sources where id=any(p_source_ids) and evidence_provenance='synthetic-demo'
    union all select 'item:'||source_id||':'||id flag from public.source_items where id=any(p_item_ids) and evidence_provenance='synthetic-demo'
  ) rows;
  return result;
end;
$$;
revoke all on function public.storage_read_evidence_provenance(jsonb,text[],text[]) from public,anon,authenticated;
grant execute on function public.storage_read_evidence_provenance(jsonb,text[],text[]) to service_role;

-- Ownership proof cannot overwrite a newer registry/catalog row after feed IO.
create function public.verify_source_if_unchanged(p_source_id text,p_wallet_address text,p_feed_url text) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare changed integer;
begin
  if p_source_id is null or length(p_source_id) not between 1 and 256 or p_wallet_address is null or p_wallet_address !~* '^0x[0-9a-f]{40}$'
    or p_feed_url is null or length(p_feed_url) not between 1 and 4096 then raise exception 'source verification identity refused'; end if;
  update public.sources set verified=true where id=p_source_id and lower(wallet_address)=lower(p_wallet_address)
    and coalesce(nullif(rss_url,''),url)=p_feed_url;
  get diagnostics changed=row_count;
  return changed=1;
end;
$$;
revoke all on function public.verify_source_if_unchanged(text,text,text) from public,anon,authenticated;
grant execute on function public.verify_source_if_unchanged(text,text,text) to service_role;
insert into keryx_storage.operations(operation,relations,real_only,read_only)
values('verify_source_if_unchanged',array['sources']::text[],false,false);
create function public.storage_verify_source_if_unchanged(p_expected_identity jsonb,p_source_id text,p_wallet_address text,p_feed_url text) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare changed integer;
begin
  if p_source_id is null or length(p_source_id) not between 1 and 256 or p_wallet_address is null or p_wallet_address !~* '^0x[0-9a-f]{40}$'
    or p_feed_url is null or length(p_feed_url) not between 1 and 4096 then raise exception 'source verification identity refused'; end if;
  perform keryx_storage.enter_operation(p_expected_identity,'verify_source_if_unchanged');
  update public.sources set verified=true where id=p_source_id and lower(wallet_address)=lower(p_wallet_address)
    and coalesce(nullif(rss_url,''),url)=p_feed_url;
  get diagnostics changed=row_count;
  perform keryx_storage.leave_operation();
  return changed=1;
end;
$$;
revoke all on function public.storage_verify_source_if_unchanged(jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.storage_verify_source_if_unchanged(jsonb,text,text,text) to service_role;
commit;
