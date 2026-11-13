SET ROLE keryx_owner;
INSERT INTO keryx_storage.operations(operation,relations,real_only,read_only) VALUES
 ('public_profile_read',ARRAY['public_researcher_profiles','private_profiles','query_runs','run_privacy','anonymous_run_claims','a2a_orders','profile_verified_identities','payment_events']::text[],true,true),
 ('public_profile_settings',ARRAY['public_researcher_profiles','private_profiles','web_sessions']::text[],true,true),
 ('public_profile_sitemap',ARRAY['public_researcher_profiles','private_profiles']::text[],true,true),
 ('public_profile_update',ARRAY['public_researcher_profiles']::text[],true,false),
 ('public_profile_unpublish',ARRAY['public_researcher_profiles']::text[],true,false);
CREATE TRIGGER native_public_profile_writer BEFORE INSERT OR UPDATE OR DELETE ON public.public_researcher_profiles FOR EACH ROW EXECUTE FUNCTION keryx_storage.write_fence();
-- A new snapshot is taken after require_operation, including any writer wait.
CREATE FUNCTION keryx_storage.public_profile_actor(actor jsonb,stamp bigint) RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_wallet text;
BEGIN
 IF actor IS NULL OR jsonb_typeof(actor)<>'object' OR actor-'wallet'-'sessionHash'-'binding'<>'{}'::jsonb
  OR jsonb_typeof(actor->'wallet') IS DISTINCT FROM 'string' OR jsonb_typeof(actor->'sessionHash') IS DISTINCT FROM 'string'
  OR jsonb_typeof(actor->'binding') IS DISTINCT FROM 'object' OR (actor->'binding')-'origin'-'network'<>'{}'::jsonb
  OR actor->'binding'->>'origin' IS DISTINCT FROM (SELECT origin FROM keryx_storage.control WHERE singleton)
  OR actor->'binding'->>'network' IS DISTINCT FROM (SELECT identity->>'network' FROM keryx_storage.identity WHERE singleton)
  OR actor->>'wallet' IS NULL OR actor->>'wallet' !~ '^0x[0-9a-f]{40}$' OR actor->>'sessionHash' IS NULL OR actor->>'sessionHash' !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'unauthenticated';END IF;
 actor_wallet:=actor->>'wallet';
 IF NOT EXISTS(SELECT 1 FROM public.web_sessions s WHERE s.hash=actor->>'sessionHash' AND s.wallet=actor_wallet AND s.issued_at<=stamp AND s.expires_at>stamp) THEN RAISE EXCEPTION 'unauthenticated';END IF;
 RETURN actor_wallet;
END;$$;
CREATE FUNCTION keryx_storage.public_profile_settings(wallet text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE p record;s record;
BEGIN
 SELECT handle INTO p FROM public.private_profiles WHERE private_profiles.wallet=public_profile_settings.wallet;
 SELECT * INTO s FROM public.public_researcher_profiles WHERE public_researcher_profiles.wallet=public_profile_settings.wallet;
 IF s.wallet IS NOT NULL AND(octet_length(s.fields)>256 OR octet_length(s.run_ids)>8192 OR octet_length(s.updated_at)>64) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 IF s.wallet IS NOT NULL AND(
  EXISTS(SELECT 1 FROM jsonb_array_elements(s.fields::jsonb) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN('displayName','about','purpose','verifiedLinks','ledgers'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(s.run_ids::jsonb) x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$')
  OR(SELECT count(DISTINCT x) FROM jsonb_array_elements(s.fields::jsonb) x)<>jsonb_array_length(s.fields::jsonb)
  OR(SELECT count(DISTINCT x) FROM jsonb_array_elements(s.run_ids::jsonb) x)<>jsonb_array_length(s.run_ids::jsonb)) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 RETURN jsonb_build_object('handle',coalesce(p.handle,''),'published',coalesce(s.published=1 AND s.handle=p.handle,false),'fields',coalesce(s.fields::jsonb,'[]'::jsonb),
  'runIds',coalesce(s.run_ids::jsonb,'[]'::jsonb),'revision',coalesce(s.revision,0),'updatedAt',s.updated_at);
END;$$;
-- Private proof predicate uses the same exact original, completion and A2A
-- exclusions as ownership history. No caller assertion can grant association.
CREATE FUNCTION keryx_storage.public_profile_owned(selected_id text,wallet text,binding jsonb,claims boolean) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.query_runs q LEFT JOIN public.run_privacy v ON v.run_id=q.id
  LEFT JOIN public.anonymous_run_claims c ON c.run_id=q.id AND c.network=binding->>'network' AND c.origin=binding->>'origin'
  LEFT JOIN keryx_storage.run_ownership_projection o ON o.run_id=q.id
  WHERE q.id=selected_id AND coalesce(v.erased,0)=0 AND(q.asker=wallet OR(q.asker IS NULL AND claims AND c.claimed_wallet=wallet AND c.claimed_at IS NOT NULL
   AND q.created_at=c.completed_at::timestamptz AND o.history_eligible AND o.claimed_valid AND octet_length(q.data::text)<=4000000
   AND o.original_sha256=c.original_sha256 AND CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data)=c.original_sha256 ELSE false END
   AND NOT EXISTS(SELECT 1 FROM public.a2a_orders a WHERE a.query_id=q.id))));
$$;
CREATE FUNCTION keryx_storage.public_profile_capture(handle text,claims boolean) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE current_profile record;s record;r record;selected jsonb;binding jsonb;profile jsonb;runs jsonb:='[]';ledger jsonb:='[]';ledger_groups jsonb[]:='{}';part jsonb;ledger_bytes bigint:=2;verified jsonb;bytes bigint:=0;groups integer:=0;
BEGIN
 SELECT v.* INTO s FROM public.public_researcher_profiles v JOIN public.private_profiles p ON p.wallet=v.wallet AND p.handle=v.handle WHERE v.handle=public_profile_capture.handle AND v.published=1;
 IF NOT FOUND THEN RETURN NULL;END IF;
 selected:=keryx_storage.public_profile_settings(s.wallet);
 IF octet_length(s.binding)>2048 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;binding:=s.binding::jsonb;
 IF NOT keryx_storage.account_binding_valid(binding) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 SELECT * INTO current_profile FROM public.private_profiles WHERE wallet=s.wallet;
 profile:=jsonb_build_object('version',1,'handle',s.handle,'publishedAt',s.updated_at,'ownershipBasis','signed-wallet-publication-existing-run-proof');
 IF selected->'fields'?'displayName' THEN profile:=profile||jsonb_build_object('displayName',current_profile.display_name);END IF;
 IF selected->'fields'?'about' THEN profile:=profile||jsonb_build_object('about',current_profile.bio);END IF;
 IF selected->'fields'?'purpose' THEN profile:=profile||jsonb_build_object('purpose',current_profile.purpose);END IF;
 IF selected->'fields'?'verifiedLinks' THEN
  IF EXISTS(SELECT 1 FROM public.profile_verified_identities i WHERE i.wallet=s.wallet AND i.external_id IS NOT NULL AND(octet_length(i.label)>640 OR octet_length(i.external_id)>128 OR octet_length(i.verified_at)>64)) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('provider',i.provider,'label',i.label,'externalId',i.external_id,'verifiedAt',i.verified_at) ORDER BY i.provider),'[]') INTO verified
   FROM public.profile_verified_identities i WHERE i.wallet=s.wallet AND i.external_id IS NOT NULL;
  IF jsonb_array_length(verified)>2 OR octet_length(verified::text)>8192 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;profile:=profile||jsonb_build_object('verified',verified);
 END IF;
 IF claims AND EXISTS(SELECT 1 FROM public.query_runs q JOIN public.run_privacy v ON v.run_id=q.id
  JOIN public.anonymous_run_claims c ON c.run_id=q.id AND c.network=binding->>'network' AND c.origin=binding->>'origin'
  LEFT JOIN keryx_storage.run_ownership_projection o ON o.run_id=q.id
  WHERE q.id IN(SELECT jsonb_array_elements_text(selected->'runIds')) AND v.visibility='public' AND v.erased=0 AND q.asker IS NULL AND c.claimed_wallet=s.wallet AND c.claimed_at IS NOT NULL
   AND q.created_at=c.completed_at::timestamptz AND CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data)=c.original_sha256 ELSE false END
   AND NOT EXISTS(SELECT 1 FROM public.a2a_orders a WHERE a.query_id=q.id)
   AND(o.history_eligible IS DISTINCT FROM true OR o.claimed_valid IS DISTINCT FROM true OR o.original_sha256 IS DISTINCT FROM c.original_sha256)) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 FOR r IN SELECT q.id,q.asker,m.profile_fields,m.original_sha256,m.data_bytes,octet_length(q.data::text) actual_bytes,CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data) END original_hash,h.owner_invalid,h.recorded_owner
  FROM public.query_runs q JOIN public.run_privacy v ON v.run_id=q.id
  LEFT JOIN keryx_storage.run_privacy_projection m ON m.run_id=q.id LEFT JOIN keryx_storage.run_history_projection h ON h.run_id=q.id
  WHERE q.id IN(SELECT jsonb_array_elements_text(selected->'runIds')) AND v.visibility='public' AND v.erased=0
   AND keryx_storage.public_profile_owned(q.id,s.wallet,binding,claims) ORDER BY q.created_at DESC,q.id COLLATE "C" DESC LIMIT 50 LOOP
  IF r.profile_fields IS NULL OR r.data_bytes IS DISTINCT FROM r.actual_bytes OR r.original_sha256 IS DISTINCT FROM r.original_hash
   OR r.asker IS NOT NULL AND(r.owner_invalid IS DISTINCT FROM false OR r.recorded_owner IS NOT NULL AND r.recorded_owner<>s.wallet)
  THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
  bytes:=bytes+octet_length(r.profile_fields);IF bytes>8388608 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
  runs:=runs||jsonb_build_array(jsonb_build_object('wireHex',encode(convert_to(r.profile_fields,'UTF8'),'hex'),'claimed',r.asker IS NULL,
   'networks',(SELECT coalesce(jsonb_agg(x.network),'[]') FROM(SELECT DISTINCT e.network FROM public.payment_events e WHERE e.query_id=r.id LIMIT 3)x)));
 END LOOP;
 IF selected->'fields'?'ledgers' THEN
  -- Group identical original numeric values and role masks, then apply the
  -- existing JS Number/recordedMicros admission in Node. No SQL float rounding.
  -- This transfers counts, never payment identities, receipt or wallet details.
  IF EXISTS(SELECT 1 FROM public.payment_events e JOIN public.query_runs q ON q.id=e.query_id LEFT JOIN keryx_storage.run_privacy_projection m ON m.run_id=q.id
   WHERE e.network IN('eip155:5042','eip155:5042002') AND e.kind IN('fetch','citation') AND e.settled=true AND e.settlement_status='settled' AND e.amount_usdc>0 AND e.tx_hash IS NOT NULL AND length(btrim(e.tx_hash))>0
    AND(lower(e.payer)=s.wallet OR lower(e.payee)=s.wallet OR q.asker=s.wallet)
    AND(m.payment_offline IS NULL OR m.funding_offline IS NULL OR m.funding_treasury IS NULL OR m.original_sha256 IS DISTINCT FROM CASE WHEN octet_length(q.data::text)<=4000000 THEN keryx_storage.run_original_sha256(q.data) END))
  THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
  FOR r IN SELECT e.network,lower(e.payer)=s.wallet AND NOT coalesce(m.funding_treasury,false) reader,lower(e.payee)=s.wallet creator,
   q.asker=s.wallet AND coalesce(m.funding_treasury,false) sponsored,e.amount_usdc,count(*)::text count
   FROM public.payment_events e LEFT JOIN public.query_runs q ON q.id=e.query_id LEFT JOIN keryx_storage.run_privacy_projection m ON m.run_id=q.id
   WHERE e.network IN('eip155:5042','eip155:5042002') AND e.kind IN('fetch','citation') AND e.settled=true AND e.settlement_status='settled' AND e.amount_usdc>0 AND e.tx_hash IS NOT NULL AND length(btrim(e.tx_hash))>0
    AND NOT coalesce(m.payment_offline,false) AND NOT coalesce(m.funding_offline,false)
    AND(lower(e.payer)=s.wallet OR lower(e.payee)=s.wallet OR q.asker=s.wallet AND coalesce(m.funding_treasury,false))
   GROUP BY e.network,reader,creator,sponsored,e.amount_usdc LIMIT 65537 LOOP
   groups:=groups+1;IF groups>65536 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
   part:=jsonb_build_object('network',r.network,'reader',coalesce(r.reader,false),'creator',coalesce(r.creator,false),'sponsored',coalesce(r.sponsored,false),
    'amount',CASE WHEN octet_length(r.amount_usdc::text)<=256 THEN r.amount_usdc::text END,'count',r.count);ledger_bytes:=ledger_bytes+octet_length(part::text)+2;
   IF ledger_bytes>4194304 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;ledger_groups:=array_append(ledger_groups,part);
  END LOOP;ledger:=to_jsonb(ledger_groups);profile:=profile||jsonb_build_object('ledgerBasis','wallet-wide-recorded-settled-creator-events');
 END IF;
 RETURN jsonb_build_object('profile',profile,'runs',runs,'ledger',ledger);
END;$$;
CREATE FUNCTION public.storage_public_profile_observe(expected jsonb,digest text,action text,input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE result jsonb;wallet text;
BEGIN
 IF current_setting('transaction_read_only')<>'on' OR action IS NULL OR action NOT IN('read','settings','sitemap') OR input IS NULL OR octet_length(input::text)>4096 THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_profile_'||action);
 BEGIN
  CASE action
   WHEN 'read' THEN
    IF input-'handle'-'claims'<>'{}'::jsonb OR jsonb_typeof(input->'claims') IS DISTINCT FROM 'boolean' OR input->>'handle' IS NULL OR input->>'handle' !~ '^[a-z][a-z0-9_]{2,31}$' THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
    result:=keryx_storage.public_profile_capture(input->>'handle',(input->>'claims')::boolean);
   WHEN 'settings' THEN wallet:=keryx_storage.public_profile_actor(input,floor(extract(epoch FROM clock_timestamp())*1000)::bigint);result:=keryx_storage.public_profile_settings(wallet);
   WHEN 'sitemap' THEN
    IF input-'take'<>'{}'::jsonb OR jsonb_typeof(input->'take') IS DISTINCT FROM 'number' OR(input->>'take')::numeric NOT BETWEEN 1 AND 1000 OR(input->>'take')::numeric<>trunc((input->>'take')::numeric) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
    IF EXISTS(SELECT 1 FROM(SELECT v.handle,v.updated_at FROM public.public_researcher_profiles v JOIN public.private_profiles p ON p.wallet=v.wallet AND p.handle=v.handle WHERE v.published=1 ORDER BY v.handle COLLATE "C" LIMIT(input->>'take')::integer)x WHERE octet_length(x.handle)>128 OR octet_length(x.updated_at)>64) THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM(SELECT v.handle,v.updated_at "updatedAt" FROM public.public_researcher_profiles v JOIN public.private_profiles p ON p.wallet=v.wallet AND p.handle=v.handle WHERE v.published=1 ORDER BY v.handle COLLATE "C" LIMIT(input->>'take')::integer)x;
  END CASE;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN('public_profile_unavailable','unauthenticated') THEN RAISE;END IF;RETURN jsonb_build_object('ok',false,'error',SQLERRM);END;
 RETURN jsonb_build_object('ok',true,'value',result);
END;$$;
CREATE FUNCTION public.storage_public_profile_write(expected jsonb,digest text,action text,actor jsonb,input jsonb,claims boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE actor_wallet text;handle text;result jsonb;stamp text;id text;
BEGIN
 IF action IS NULL OR action NOT IN('update','unpublish') OR claims IS NULL THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'public_profile_'||action);
 BEGIN
  actor_wallet:=keryx_storage.public_profile_actor(actor,floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
  SELECT p.handle INTO handle FROM public.private_profiles p WHERE p.wallet=actor_wallet;
  stamp:=to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  IF action='update' THEN
   IF coalesce(handle,'')='' THEN RAISE EXCEPTION 'profile_required';END IF;
   IF input IS NULL OR jsonb_typeof(input)<>'object' OR input-'published'-'fields'-'runIds'-'revision'<>'{}'::jsonb OR octet_length(input::text)>12288
    OR jsonb_typeof(input->'published') IS DISTINCT FROM 'boolean' OR jsonb_typeof(input->'fields') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'fields')>5
    OR jsonb_typeof(input->'runIds') IS DISTINCT FROM 'array' OR jsonb_array_length(input->'runIds')>50 OR jsonb_typeof(input->'revision') IS DISTINCT FROM 'number'
    OR(input->>'revision')::numeric NOT BETWEEN 0 AND 2147483646 OR(input->>'revision')::numeric<>trunc((input->>'revision')::numeric)
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'fields') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' NOT IN('displayName','about','purpose','verifiedLinks','ledgers'))
    OR EXISTS(SELECT 1 FROM jsonb_array_elements(input->'runIds') x WHERE jsonb_typeof(x)<>'string' OR x#>>'{}' !~ '^[A-Za-z0-9_-]{1,128}$')
    OR(SELECT count(DISTINCT x) FROM jsonb_array_elements(input->'fields') x)<>jsonb_array_length(input->'fields')
    OR(SELECT count(DISTINCT x) FROM jsonb_array_elements(input->'runIds') x)<>jsonb_array_length(input->'runIds') THEN RAISE EXCEPTION 'public_profile_unavailable';END IF;
   IF(keryx_storage.public_profile_settings(actor_wallet)->>'revision')::numeric<>(input->>'revision')::numeric THEN RAISE EXCEPTION 'conflict';END IF;
   IF(input->>'published')::boolean THEN FOR id IN SELECT jsonb_array_elements_text(input->'runIds') LOOP
    IF NOT keryx_storage.public_profile_owned(id,actor_wallet,actor->'binding',claims) THEN RAISE EXCEPTION 'not_owned';END IF;
   END LOOP;END IF;
   PERFORM keryx_storage.public_profile_actor(actor,floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
   INSERT INTO public.public_researcher_profiles VALUES(actor_wallet,handle,CASE WHEN(input->>'published')::boolean THEN 1 ELSE 0 END,(input->'fields')::text,(input->'runIds')::text,(actor->'binding')::text,(input->>'revision')::numeric+1,stamp)
    ON CONFLICT ON CONSTRAINT public_researcher_profiles_pkey DO UPDATE SET handle=excluded.handle,published=excluded.published,fields=excluded.fields,run_ids=excluded.run_ids,binding=excluded.binding,revision=excluded.revision,updated_at=excluded.updated_at;
   result:=keryx_storage.public_profile_settings(actor_wallet);
  ELSE
   IF NOT EXISTS(SELECT 1 FROM public.public_researcher_profiles p WHERE p.wallet=actor_wallet) AND coalesce(handle,'')='' THEN RAISE EXCEPTION 'profile_required';END IF;
   PERFORM keryx_storage.public_profile_actor(actor,floor(extract(epoch FROM clock_timestamp())*1000)::bigint);
   INSERT INTO public.public_researcher_profiles VALUES(actor_wallet,coalesce(handle,''),0,'[]','[]',(actor->'binding')::text,1,stamp)
    ON CONFLICT ON CONSTRAINT public_researcher_profiles_pkey DO UPDATE SET published=0,revision=least(public_researcher_profiles.revision+1,2147483647),updated_at=excluded.updated_at;result:='null';
  END IF;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT IN('public_profile_unavailable','unauthenticated','profile_required','conflict','not_owned') THEN RAISE;END IF;result:=jsonb_build_object('error',SQLERRM);END;
 PERFORM keryx_storage.leave_operation();
 IF result?'error' THEN RETURN jsonb_build_object('ok',false,'error',result->>'error');END IF;RETURN jsonb_build_object('ok',true,'value',result);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_public_profile_observe(jsonb,text,text,jsonb),public.storage_public_profile_write(jsonb,text,text,jsonb,jsonb,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.storage_public_profile_observe(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_public_profile_write(jsonb,text,text,jsonb,jsonb,boolean) TO keryx_app;
RESET ROLE;
