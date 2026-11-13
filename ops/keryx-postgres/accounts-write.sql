SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.account_challenge_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 RETURN c IS NOT NULL AND jsonb_typeof(c)='object'
  AND c-'version'-'purpose'-'accountId'-'revision'-'wallet'-'generation'-'sessionCommitment'-'consentHash'-'binding'-'issuedAt'-'expiresAt'='{}'::jsonb
  AND c->'version'='1'::jsonb AND c->>'purpose' IN('create-private-account','link-wallet')
  AND jsonb_typeof(c->'accountId')='string' AND c->>'accountId' ~ '^acct_[a-f0-9]{64}$'
  AND jsonb_typeof(c->'wallet')='string' AND c->>'wallet' ~ '^0x[a-f0-9]{40}$' AND c->>'wallet'<>'0x0000000000000000000000000000000000000000'
  AND jsonb_typeof(c->'generation')='string' AND c->>'generation' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(c->'sessionCommitment')='string' AND c->>'sessionCommitment' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(c->'consentHash')='string' AND c->>'consentHash' ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(c->'revision')='number' AND (c->>'revision')::numeric=trunc((c->>'revision')::numeric) AND (c->>'revision')::numeric BETWEEN 0 AND 9007199254740991
  AND jsonb_typeof(c->'issuedAt')='number' AND jsonb_typeof(c->'expiresAt')='number'
  AND (c->>'issuedAt')::numeric=trunc((c->>'issuedAt')::numeric) AND (c->>'expiresAt')::numeric=trunc((c->>'expiresAt')::numeric)
  AND (c->>'issuedAt')::numeric BETWEEN 0 AND 8639999999700000 AND (c->>'expiresAt')::numeric BETWEEN 0 AND 8639999999700000
  AND (c->>'expiresAt')::numeric=(c->>'issuedAt')::numeric+300000 AND keryx_storage.account_binding_valid(c->'binding');
EXCEPTION WHEN OTHERS THEN RETURN false;END;$$;
CREATE FUNCTION keryx_storage.account_commitment(s jsonb,nonce_hash text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to('keryx-account-session-commitment-v1:'||(s->>'sessionHash')||':'||((s->>'issuedAt')::bigint)::text||':'||((s->>'expiresAt')::bigint)::text||':'||nonce_hash,'UTF8')),'hex');
$$;
CREATE FUNCTION keryx_storage.account_consent(purpose text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(CASE purpose WHEN 'link-wallet' THEN 'keryx-account-consent-v1:share-past-and-future-owned-history:wallet-authority-stays-separate' ELSE 'keryx-account-consent-v1:create-private-account:share-owned-history' END,'UTF8')),'hex');
$$;
CREATE FUNCTION keryx_storage.account_bind(s jsonb,selected_id text,member_generation text,credential_generation text,b jsonb,stamp bigint) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF (SELECT count(*) FROM(SELECT 1 FROM public.account267_sessions WHERE account_id=selected_id AND revoked_at IS NULL AND expires_at>stamp LIMIT 1024)r)>=1024 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 INSERT INTO public.account267_sessions(session_hash,wallet,account_id,member_generation,credential_generation,issued_at,expires_at,origin,network,history_consent,revoked_at)
 VALUES(s->>'sessionHash',s->>'wallet',selected_id,member_generation,credential_generation,(s->>'issuedAt')::bigint,(s->>'expiresAt')::bigint,b->>'origin',b->>'network',1,NULL);
END;$$;
CREATE FUNCTION keryx_storage.account_event(c jsonb,purpose text,revision bigint,proof_hash text,event_id text,stamp bigint) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF event_id IS NULL OR event_id !~ '^[a-f0-9]{64}$' OR proof_hash IS NULL OR proof_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'account_unavailable';END IF;
 IF(SELECT count(*) FROM(SELECT 1 FROM public.account267_events WHERE account_id=c->>'accountId' LIMIT 1024)r)>=1024 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 INSERT INTO public.account267_events(id,account_id,revision,purpose,lineage_hash,consent_hash,proof_hash,created_at)
 VALUES(event_id,c->>'accountId',revision,purpose,encode(sha256(convert_to('keryx-membership-lineage-v1:'||(c->>'generation'),'UTF8')),'hex'),c->>'consentHash',proof_hash,stamp);
END;$$;
CREATE FUNCTION keryx_storage.account_mutate(action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
<<account_mutate>>
DECLARE stamp bigint;s jsonb;b jsonb;c jsonb;a jsonb;membership jsonb;row public.account267_challenges%rowtype;
 m public.account267_members%rowtype;credential public.account267_credentials%rowtype;wire text;nonce_hash text;lease text;proof_hash text;generated jsonb;
 wallet text;generation text;pending text[];sessions text[];cancel_hash text;affected integer;
BEGIN
 IF args IS NULL OR jsonb_typeof(args)<>'object' OR octet_length(args::text)>32768 THEN RAISE EXCEPTION 'account_unavailable';END IF;
 stamp:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;s:=args->'session';b:=args->'binding';generated:=args->'generated';
 IF action IN('unlink','revoke') THEN a:=keryx_storage.account_current(args->'snapshot',stamp);s:=a->'session';b:=a->'binding';ELSE PERFORM keryx_storage.account_live(s,stamp);END IF;
 CASE action
 WHEN 'resume' THEN
  IF args-'session'-'binding'-'expected'-'consent'<>'{}'::jsonb OR args->'consent' IS DISTINCT FROM '{"version":1,"privateAccount":true,"shareOwnedHistory":true}'::jsonb
   OR args->'expected' IS NULL OR jsonb_typeof(args->'expected')<>'object' OR (args->'expected')-'accountId'-'revision'<>'{}'::jsonb THEN RAISE EXCEPTION 'account_unavailable';END IF;
  a:=keryx_storage.account_resolve(s,b,stamp);
  IF a IS NOT NULL THEN
   IF a->'membership'->'accountId' IS DISTINCT FROM args->'expected'->'accountId' OR a->'membership'->'revision' IS DISTINCT FROM args->'expected'->'revision' THEN RAISE EXCEPTION 'account_changed';END IF;RETURN a;
  END IF;
  SELECT * INTO m FROM public.account267_members WHERE public.account267_members.wallet=s->>'wallet';IF NOT FOUND THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
  SELECT * INTO credential FROM public.account267_credentials WHERE public.account267_credentials.wallet=s->>'wallet';
  IF NOT FOUND OR credential.active<>1 OR credential.account_id IS DISTINCT FROM m.account_id OR credential.member_generation IS DISTINCT FROM m.generation OR (s->>'issuedAt')::bigint<credential.login_after THEN RAISE EXCEPTION 'account_unauthenticated';END IF;
  membership:=keryx_storage.account_membership(m.account_id);
  IF membership->'accountId' IS DISTINCT FROM args->'expected'->'accountId' OR membership->'revision' IS DISTINCT FROM args->'expected'->'revision' THEN RAISE EXCEPTION 'account_changed';END IF;
  PERFORM keryx_storage.account_bind(s,m.account_id,m.generation,credential.generation,b,stamp);RETURN keryx_storage.account_resolve(s,b,stamp);
 WHEN 'issue' THEN
  IF args-'session'-'challengeWire'-'nonceHash'<>'{}'::jsonb OR jsonb_typeof(args->'challengeWire') IS DISTINCT FROM 'string' OR octet_length(args->>'challengeWire')>8192 OR jsonb_typeof(args->'nonceHash') IS DISTINCT FROM 'string' OR args->>'nonceHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'account_unavailable';END IF;
  wire:=args->>'challengeWire';c:=wire::jsonb;nonce_hash:=args->>'nonceHash';
  IF NOT coalesce(keryx_storage.account_challenge_valid(c),false) OR c->>'sessionCommitment' IS DISTINCT FROM keryx_storage.account_commitment(s,nonce_hash)
   OR c->>'consentHash' IS DISTINCT FROM keryx_storage.account_consent(c->>'purpose') OR (c->>'issuedAt')::bigint>stamp OR (c->>'issuedAt')::bigint<stamp-5000 OR (c->>'expiresAt')::bigint<=stamp THEN RAISE EXCEPTION 'invalid_membership_proof';END IF;
  IF c->>'purpose'='create-private-account' THEN
   IF c->>'wallet' IS DISTINCT FROM s->>'wallet' OR c->'revision'<>'0'::jsonb OR EXISTS(SELECT 1 FROM public.account267_members WHERE public.account267_members.wallet=s->>'wallet') OR EXISTS(SELECT 1 FROM public.account267_sessions WHERE session_hash=s->>'sessionHash') THEN RAISE EXCEPTION 'wallet_unavailable';END IF;
  ELSE
   a:=keryx_storage.account_resolve(s,c->'binding',stamp);
   IF a IS NULL OR a->'membership'->'accountId' IS DISTINCT FROM c->'accountId' OR a->'membership'->'revision' IS DISTINCT FROM c->'revision' THEN RAISE EXCEPTION 'account_changed';END IF;
   IF jsonb_array_length(a->'membership'->'members')>=8 THEN RAISE EXCEPTION 'account_full';END IF;
   IF EXISTS(SELECT 1 FROM public.account267_members WHERE public.account267_members.wallet=c->>'wallet') THEN RAISE EXCEPTION 'wallet_unavailable';END IF;
  END IF;
  IF(SELECT count(*) FROM(SELECT 1 FROM public.account267_challenges WHERE session_hash=s->>'sessionHash' AND expires_at>stamp AND consumed_at IS NULL LIMIT 8)r)>=8
   OR(SELECT count(*) FROM(SELECT 1 FROM public.account267_challenges WHERE session_hash=s->>'sessionHash' LIMIT 1024)r)>=1024
   OR(SELECT count(*) FROM(SELECT 1 FROM public.account267_challenges WHERE payload::jsonb->>'accountId'=c->>'accountId' LIMIT 1024)r)>=1024 THEN RAISE EXCEPTION 'account_unavailable';END IF;
  INSERT INTO public.account267_challenges(nonce_hash,session_hash,payload,expires_at) VALUES(nonce_hash,s->>'sessionHash',wire,(c->>'expiresAt')::bigint);RETURN NULL;
 WHEN 'take' THEN
  IF args-'session'-'binding'-'nonce'-'purpose'-'lease'<>'{}'::jsonb OR NOT keryx_storage.account_binding_valid(b) OR jsonb_typeof(args->'nonce') IS DISTINCT FROM 'string' OR args->>'nonce' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(args->'lease') IS DISTINCT FROM 'string' OR args->>'lease' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'account_unavailable';END IF;
  nonce_hash:=encode(sha256(convert_to('keryx-account-membership-nonce-v1:'||(args->>'nonce'),'UTF8')),'hex');lease:=args->>'lease';
  SELECT * INTO row FROM public.account267_challenges WHERE public.account267_challenges.nonce_hash=account_mutate.nonce_hash;
  IF NOT FOUND OR row.consumed_at IS NOT NULL THEN RETURN NULL;END IF;
  UPDATE public.account267_challenges SET consumed_at=stamp,lease_hash=encode(sha256(convert_to('keryx-membership-lease-v1:'||lease,'UTF8')),'hex') WHERE public.account267_challenges.nonce_hash=account_mutate.nonce_hash AND consumed_at IS NULL;
  -- Invalid attempts retain their spent marker. Only data/domain work is inside
  -- this catch; the outer fresh native authority check is outside all catches.
  BEGIN
   c:=row.payload::jsonb;
   IF NOT coalesce(keryx_storage.account_challenge_valid(c),false) OR row.session_hash IS DISTINCT FROM s->>'sessionHash' OR row.expires_at<>(c->>'expiresAt')::bigint OR (c->>'issuedAt')::bigint>stamp OR (c->>'expiresAt')::bigint<=stamp
    OR c->>'purpose' IS DISTINCT FROM args->>'purpose' OR c->'binding' IS DISTINCT FROM b OR c->>'sessionCommitment' IS DISTINCT FROM keryx_storage.account_commitment(s,nonce_hash) OR c->>'consentHash' IS DISTINCT FROM keryx_storage.account_consent(c->>'purpose') THEN RETURN NULL;END IF;
   IF c->>'purpose'='create-private-account' THEN
    IF c->>'wallet' IS DISTINCT FROM s->>'wallet' OR c->'revision'<>'0'::jsonb OR EXISTS(SELECT 1 FROM public.account267_members WHERE public.account267_members.wallet=s->>'wallet') THEN RETURN NULL;END IF;
   ELSE
    a:=keryx_storage.account_resolve(s,b,stamp);IF a IS NULL OR a->'membership'->'accountId' IS DISTINCT FROM c->'accountId' OR a->'membership'->'revision' IS DISTINCT FROM c->'revision' THEN RETURN NULL;END IF;
   END IF;
   RETURN jsonb_build_object('challenge',c,'nonce',args->'nonce','lease',args->'lease');
  EXCEPTION WHEN OTHERS THEN RETURN NULL;END;
 WHEN 'complete' THEN
  IF args-'session'-'challengeWire'-'nonce'-'lease'-'proofHash'-'generated'<>'{}'::jsonb OR jsonb_typeof(args->'challengeWire') IS DISTINCT FROM 'string' OR octet_length(args->>'challengeWire')>8192
   OR jsonb_typeof(args->'nonce') IS DISTINCT FROM 'string' OR args->>'nonce' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(args->'lease') IS DISTINCT FROM 'string' OR args->>'lease' !~ '^[a-f0-9]{64}$'
   OR jsonb_typeof(args->'proofHash') IS DISTINCT FROM 'string' OR args->>'proofHash' !~ '^[a-f0-9]{64}$' OR generated IS NULL OR jsonb_typeof(generated)<>'object' OR generated-'credentialGeneration'-'eventId'<>'{}'::jsonb
   OR jsonb_typeof(generated->'credentialGeneration') IS DISTINCT FROM 'string' OR generated->>'credentialGeneration' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(generated->'eventId') IS DISTINCT FROM 'string' OR generated->>'eventId' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'account_unavailable';END IF;
  wire:=args->>'challengeWire';c:=wire::jsonb;IF NOT coalesce(keryx_storage.account_challenge_valid(c),false) THEN RAISE EXCEPTION 'invalid_membership_proof';END IF;
  nonce_hash:=encode(sha256(convert_to('keryx-account-membership-nonce-v1:'||(args->>'nonce'),'UTF8')),'hex');lease:=args->>'lease';proof_hash:=args->>'proofHash';
  SELECT * INTO row FROM public.account267_challenges WHERE public.account267_challenges.nonce_hash=account_mutate.nonce_hash;
  IF NOT FOUND OR row.session_hash IS DISTINCT FROM s->>'sessionHash' OR row.payload IS DISTINCT FROM wire OR row.consumed_at IS NULL OR row.completed_at IS NOT NULL
   OR row.lease_hash IS DISTINCT FROM encode(sha256(convert_to('keryx-membership-lease-v1:'||lease,'UTF8')),'hex') OR row.expires_at<>(c->>'expiresAt')::bigint OR (c->>'issuedAt')::bigint>stamp OR (c->>'expiresAt')::bigint<=stamp OR c->>'sessionCommitment' IS DISTINCT FROM keryx_storage.account_commitment(s,nonce_hash) THEN RAISE EXCEPTION 'invalid_membership_proof';END IF;
  a:=NULL;
  IF c->>'purpose'='create-private-account' THEN
   IF c->>'wallet' IS DISTINCT FROM s->>'wallet' OR c->'revision'<>'0'::jsonb OR EXISTS(SELECT 1 FROM public.account267_sessions WHERE session_hash=s->>'sessionHash') THEN RAISE EXCEPTION 'account_changed';END IF;
  ELSE
   a:=keryx_storage.account_resolve(s,c->'binding',stamp);
   IF a IS NULL OR a->'membership'->'accountId' IS DISTINCT FROM c->'accountId' OR a->'membership'->'revision' IS DISTINCT FROM c->'revision' THEN RAISE EXCEPTION 'account_changed';END IF;
   IF jsonb_array_length(a->'membership'->'members')>=8 THEN RAISE EXCEPTION 'account_full';END IF;IF c->'revision'='9007199254740991'::jsonb THEN RAISE EXCEPTION 'account_unavailable';END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM public.account267_members WHERE public.account267_members.wallet=c->>'wallet') THEN RAISE EXCEPTION 'wallet_unavailable';END IF;
  IF c->>'purpose'='create-private-account' THEN INSERT INTO public.account267_accounts(account_id,revision,created_at) VALUES(c->>'accountId',0,stamp);END IF;
  INSERT INTO public.account267_members(wallet,account_id,generation,consent_hash,linked_at) VALUES(c->>'wallet',c->>'accountId',c->>'generation',c->>'consentHash',stamp);
  INSERT INTO public.account267_credentials(wallet,account_id,member_generation,generation,login_after,active) VALUES(c->>'wallet',c->>'accountId',c->>'generation',generated->>'credentialGeneration',(floor(stamp::numeric/1000)+1)*1000,1);
  UPDATE public.account267_accounts SET revision=revision+1 WHERE account_id=c->>'accountId' AND revision=(c->>'revision')::bigint;GET DIAGNOSTICS affected=ROW_COUNT;IF affected<>1 THEN RAISE EXCEPTION 'account_changed';END IF;
  UPDATE public.account267_challenges SET completed_at=stamp WHERE public.account267_challenges.nonce_hash=account_mutate.nonce_hash AND completed_at IS NULL;
  PERFORM keryx_storage.account_event(c,c->>'purpose',(c->>'revision')::bigint+1,proof_hash,generated->>'eventId',stamp);
  IF a IS NULL THEN PERFORM keryx_storage.account_bind(s,c->>'accountId',c->>'generation',generated->>'credentialGeneration',c->'binding',stamp);END IF;
  RETURN keryx_storage.account_resolve(s,c->'binding',stamp);
 WHEN 'unlink' THEN
  IF args-'snapshot'-'wallet'-'generation'-'generated'<>'{}'::jsonb OR jsonb_typeof(args->'wallet') IS DISTINCT FROM 'string' OR args->>'wallet' !~ '^0x[a-f0-9]{40}$' OR jsonb_typeof(args->'generation') IS DISTINCT FROM 'string' OR args->>'generation' !~ '^[a-f0-9]{64}$'
   OR generated IS NULL OR jsonb_typeof(generated)<>'object' OR generated-'cancelHash'-'eventId'<>'{}'::jsonb OR jsonb_typeof(generated->'cancelHash') IS DISTINCT FROM 'string' OR generated->>'cancelHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(generated->'eventId') IS DISTINCT FROM 'string' OR generated->>'eventId' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'account_unavailable';END IF;
  wallet:=args->>'wallet';generation:=args->>'generation';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'membership'->'members') item WHERE item->>'wallet'=wallet AND item->>'generation'=generation) THEN RAISE EXCEPTION 'account_changed';END IF;
  IF a->'membership'->'revision'='9007199254740991'::jsonb THEN RAISE EXCEPTION 'account_unavailable';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.account267_credentials WHERE account_id=a->'membership'->>'accountId' AND public.account267_credentials.wallet<>account_mutate.wallet AND active=1) THEN RAISE EXCEPTION 'last_credential';END IF;
  SELECT coalesce(array_agg(r.nonce_hash),ARRAY[]::text[]) INTO pending FROM(SELECT q.nonce_hash FROM public.account267_challenges q WHERE q.payload::jsonb->>'accountId'=a->'membership'->>'accountId' AND q.consumed_at IS NULL LIMIT 1025)r;
  SELECT coalesce(array_agg(session_hash),ARRAY[]::text[]) INTO sessions FROM(SELECT q.session_hash FROM public.account267_sessions q WHERE q.account_id=a->'membership'->>'accountId' AND q.wallet=account_mutate.wallet AND q.revoked_at IS NULL AND q.expires_at>stamp LIMIT 1025)r;
  IF cardinality(pending)>1024 OR cardinality(sessions)>1024 THEN RAISE EXCEPTION 'account_unavailable';END IF;
  DELETE FROM public.account267_members WHERE public.account267_members.wallet=account_mutate.wallet AND account_id=a->'membership'->>'accountId' AND public.account267_members.generation=account_mutate.generation;
  DELETE FROM public.account267_credentials WHERE public.account267_credentials.wallet=account_mutate.wallet AND account_id=a->'membership'->>'accountId' AND member_generation=account_mutate.generation;
  UPDATE public.account267_sessions SET revoked_at=stamp WHERE session_hash=ANY(sessions) AND revoked_at IS NULL;
  UPDATE public.account267_accounts SET revision=revision+1 WHERE account_id=a->'membership'->>'accountId' AND revision=(a->'membership'->>'revision')::bigint;
  UPDATE public.account267_challenges SET consumed_at=stamp,lease_hash=generated->>'cancelHash' WHERE public.account267_challenges.nonce_hash=ANY(pending) AND consumed_at IS NULL;
  c:=jsonb_build_object('accountId',a->'membership'->'accountId','generation',generation,'consentHash',encode(sha256(convert_to('keryx-membership-unlink-consent-v1','UTF8')),'hex'));
  PERFORM keryx_storage.account_event(c,'unlink-wallet',(a->'membership'->>'revision')::bigint+1,encode(sha256(convert_to('unlink:'||generation,'UTF8')),'hex'),generated->>'eventId',stamp);
  IF wallet=s->>'wallet' THEN RETURN NULL;END IF;RETURN keryx_storage.account_membership(a->'membership'->>'accountId');
 WHEN 'revoke' THEN
  IF args-'snapshot'<>'{}'::jsonb THEN RAISE EXCEPTION 'account_unavailable';END IF;
  UPDATE public.account267_sessions SET revoked_at=stamp WHERE session_hash=s->>'sessionHash';RETURN NULL;
 ELSE RAISE EXCEPTION 'account_unavailable';END CASE;
END;$$;
CREATE FUNCTION public.storage_account_write(expected jsonb,digest text,selected_action text,args jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE value jsonb;failure text;
BEGIN
 IF selected_action IS NULL OR selected_action NOT IN('resume','issue','take','complete','unlink','revoke') THEN RAISE EXCEPTION 'account_unavailable';END IF;
 PERFORM keryx_storage.require_operation(expected,digest,'account_'||selected_action);
 BEGIN value:=keryx_storage.account_mutate(selected_action,args);
 EXCEPTION WHEN raise_exception THEN
  GET STACKED DIAGNOSTICS failure=MESSAGE_TEXT;
  IF failure NOT IN('account_unavailable','account_unauthenticated','account_changed','invalid_membership_proof','wallet_unavailable','account_full','last_credential','invalid_account_request') THEN RAISE;END IF;
  PERFORM keryx_storage.leave_operation();RETURN jsonb_build_object('ok',false,'error',failure);
 END;
 PERFORM keryx_storage.leave_operation();
 IF selected_action='take' AND value IS NULL THEN RETURN jsonb_build_object('ok',false,'error','invalid_membership_proof');END IF;
 RETURN jsonb_build_object('ok',true,'value',value);
END;$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
REVOKE ALL ON FUNCTION public.storage_account_write(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
GRANT EXECUTE ON FUNCTION public.storage_account_write(jsonb,text,text,jsonb) TO keryx_app;
RESET ROLE;
