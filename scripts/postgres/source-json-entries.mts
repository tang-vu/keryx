/** Fixed SOURCE-generated JSON adapters; never a runtime query translator. */
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function nativeApplicationJsonEntrySource(names:readonly string[],write=false,inputBytes=65536,group?:'operational_write'|'operational_write_article_offers'):string{
 if(names.length<1||names.length>128||new Set(names).size!==names.length||names.some(n=>!/^[_a-z][_a-z0-9]{0,62}$/.test(n)))throw new Error('Native entry source inventory refused');
 if(!Number.isSafeInteger(inputBytes)||inputBytes<65536||inputBytes>8388608)throw new Error('Native entry source input bound refused');
 if(group!==undefined){
  if(group==='operational_write_article_offers'){
   if(write!==true||inputBytes!==65536||names.length!==2||names[0]!=='set_article_offer'||names[1]!=='delete_article_offer')throw new Error('Article offer grouped SOURCE inventory refused');
   return articleOfferGroupExtension();
  }
  if(group!=='operational_write'||write!==true||names.length!==11||inputBytes!==65536)throw new Error('Native grouped entry source refused');
  return operationalWriteGroupSource(names);
 }
 return `DO $build$ DECLARE original record;arg record;fields text;arguments text;keys text[];body text;selected text;counted integer:=0;
BEGIN
 FOREACH selected IN ARRAY ARRAY[${names.map(quote).join(',')}] LOOP
  SELECT * INTO STRICT original FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='storage_'||selected;
  fields:='';arguments:='p_expected_identity=>expected';keys:=ARRAY[]::text[];
  FOR arg IN SELECT ord,type_oid FROM unnest(coalesce(original.proallargtypes,original.proargtypes::oid[])) WITH ORDINALITY a(type_oid,ord) LOOP
   IF original.proargmodes IS NOT NULL AND original.proargmodes[arg.ord] NOT IN('i','b','v') THEN CONTINUE;END IF;
   IF original.proargnames[arg.ord]='p_expected_identity' THEN CONTINUE;END IF;
   IF original.proargnames[arg.ord] IS NULL THEN RAISE EXCEPTION 'unnamed application domain argument';END IF;
   fields:=fields||CASE WHEN fields='' THEN '' ELSE ',' END||format('%I %s',original.proargnames[arg.ord],format_type(arg.type_oid,NULL));
   keys:=array_append(keys,original.proargnames[arg.ord]);
   arguments:=arguments||format(',%I=>typed.%I',original.proargnames[arg.ord],original.proargnames[arg.ord]);
  END LOOP;
  IF fields<>'' THEN EXECUTE format('CREATE TYPE keryx_storage.%I AS (%s)','args_'||selected,fields);END IF;
  IF original.proretset THEN body:=format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) INTO result FROM public.%I(%s) r;',original.proname,arguments);
  ELSIF original.prorettype='void'::regtype THEN ${write?"body:=format('PERFORM public.%I(%s);result:=NULL;',original.proname,arguments);":"RAISE EXCEPTION 'read domain returned void';"}
  ELSE body:=format('SELECT to_jsonb(public.%I(%s)) INTO result;',original.proname,arguments);END IF;
  EXECUTE format($entry$CREATE FUNCTION public.%I(expected jsonb,digest text,arguments jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
  DECLARE result jsonb;actual text[];%s
  BEGIN
   IF ${write?"current_setting('transaction_read_only')<>'off'":"current_setting('transaction_read_only')<>'on'"} OR arguments IS NULL OR jsonb_typeof(arguments)<>'object' OR octet_length(arguments::text)>${inputBytes} THEN RAISE EXCEPTION 'native application read arguments refused';END IF;
   SELECT coalesce(array_agg(key ORDER BY key),ARRAY[]::text[]) INTO actual FROM jsonb_object_keys(arguments) key;
   IF actual IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) FROM unnest(%L::text[]) k) THEN RAISE EXCEPTION 'native application argument keys refused';END IF;
   PERFORM keryx_storage.require_operation(expected,digest,%L);
   %s
   %s
   IF result IS NOT NULL AND octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native application read result bound';END IF;
   RETURN result;
  END;$fn$;$entry$,'storage_application_'||selected,
   CASE WHEN fields='' THEN '' ELSE format('typed keryx_storage.%I;','args_'||selected) END,keys,selected,
   CASE WHEN fields='' THEN '' ELSE format('SELECT * INTO typed FROM jsonb_populate_record(NULL::keryx_storage.%I,arguments);','args_'||selected) END,body);
  EXECUTE format('REVOKE ALL ON FUNCTION public.%I(jsonb,text,jsonb) FROM PUBLIC,anon,authenticated,service_role','storage_application_'||selected);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(jsonb,text,jsonb) TO ${write?"keryx_app":"keryx_app,keryx_reader"}','storage_application_'||selected);
  counted:=counted+1;
 END LOOP;
 IF counted<>${names.length} THEN RAISE EXCEPTION 'application read inventory incomplete';END IF;
END;$build$;
`;
}

/** SOURCE-time replacement of the existing closed router; no new function,
 * generic runtime dispatcher or additional legacy enter_operation issuer. */
function articleOfferGroupExtension():string{
 const branches=`WHEN 'set_article_offer' THEN
   IF NOT(payload?'p_row') OR payload-'p_row'<>'{}'::jsonb OR jsonb_typeof(payload->'p_row') IS DISTINCT FROM 'object'
    OR (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(payload->'p_row') key) IS DISTINCT FROM ARRAY['content_version','created_at','expires_at','id','item_id','nonce','price_usdc6','signature','signer','source_id']::text[]
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['source_id','item_id','id','content_version','signer','nonce','signature','created_at']) k WHERE jsonb_typeof(payload->'p_row'->k) IS DISTINCT FROM 'string' OR octet_length(payload->'p_row'->>k)>8192)
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['price_usdc6','expires_at']) k WHERE jsonb_typeof(payload->'p_row'->k) IS DISTINCT FROM 'number')
   THEN RAISE EXCEPTION 'native article offer packet refused';END IF;
   IF EXISTS(SELECT 1 FROM unnest(ARRAY['price_usdc6','expires_at']) k WHERE abs((payload->'p_row'->>k)::numeric)>9007199254740991 OR (payload->'p_row'->>k)::numeric<>trunc((payload->'p_row'->>k)::numeric)) THEN RAISE EXCEPTION 'native article offer integer representation unavailable';END IF;
   PERFORM keryx_storage.require_operation(expected,digest,'set_article_offer');
   DECLARE next_order bigint;BEGIN
    SELECT source_order INTO next_order FROM public.article_offers WHERE source_id=payload->'p_row'->>'source_id' AND item_id=payload->'p_row'->>'item_id';
    IF NOT FOUND THEN
     SELECT max(source_order) INTO next_order FROM public.article_offers;
     IF next_order=9223372036854775807 THEN RAISE EXCEPTION 'native article offer rowid representation unavailable';END IF;
     next_order:=coalesce(next_order+1,1);
    END IF;
    INSERT INTO public.article_offers(source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature,created_at,source_order)
    VALUES(payload->'p_row'->>'source_id',payload->'p_row'->>'item_id',payload->'p_row'->>'id',payload->'p_row'->>'content_version',(payload->'p_row'->>'price_usdc6')::numeric::bigint,(payload->'p_row'->>'expires_at')::numeric::bigint,payload->'p_row'->>'signer',payload->'p_row'->>'nonce',payload->'p_row'->>'signature',payload->'p_row'->>'created_at',next_order)
    ON CONFLICT(source_id,item_id) DO UPDATE SET id=excluded.id,content_version=excluded.content_version,price_usdc6=excluded.price_usdc6,expires_at=excluded.expires_at,signer=excluded.signer,nonce=excluded.nonce,signature=excluded.signature,created_at=excluded.created_at;
   END;
   PERFORM keryx_storage.leave_operation();result:=NULL;
  WHEN 'delete_article_offer' THEN
   IF (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(payload) key) IS DISTINCT FROM ARRAY['p_item_id','p_source_id']::text[]
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['p_source_id','p_item_id']) k WHERE jsonb_typeof(payload->k) IS DISTINCT FROM 'string' OR octet_length(payload->>k)>8192)
   THEN RAISE EXCEPTION 'native article offer packet refused';END IF;
   PERFORM keryx_storage.require_operation(expected,digest,'delete_article_offer');
   DELETE FROM public.article_offers WHERE source_id=payload->>'p_source_id' AND item_id=payload->>'p_item_id';
   PERFORM keryx_storage.leave_operation();result:=NULL;
  `;
 return `DO $offers$ DECLARE original record;body text;needle text:='ELSE RAISE EXCEPTION ''native application operational action refused'';';BEGIN
 SELECT * INTO STRICT original FROM pg_proc WHERE oid='public.storage_application_operational_write(jsonb,text,text,jsonb)'::regprocedure;
 IF original.proowner<>'keryx_owner'::regrole OR NOT original.prosecdef OR original.prorettype<>'jsonb'::regtype
  OR original.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[]
  OR (length(original.prosrc)-length(replace(original.prosrc,needle,'')))/length(needle)<>1
  OR position('WHEN ''set_article_offer''' IN original.prosrc)>0 OR position('WHEN ''delete_article_offer''' IN original.prosrc)>0
 THEN RAISE EXCEPTION 'article offer router predecessor refused';END IF;
 body:=replace(original.prosrc,needle,${quote(branches)}||needle);
 IF octet_length(body)>32768 THEN RAISE EXCEPTION 'operational expanded SOURCE bound';END IF;
 EXECUTE format('CREATE OR REPLACE FUNCTION public.storage_application_operational_write(expected jsonb,digest text,op text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS %L',body);
 REVOKE ALL ON FUNCTION public.storage_application_operational_write(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
 GRANT EXECUTE ON FUNCTION public.storage_application_operational_write(jsonb,text,text,jsonb) TO keryx_app;
END;$offers$;
`;
}

/** Fresh SOURCE compilation only. The runtime router contains a closed CASE,
 * not EXECUTE or a caller-selected function, relation or transaction callback. */
function operationalWriteGroupSource(names:readonly string[]):string{
 const expected=new Set(['consume_rate_limit','delete_expired_rate_limits','acquire_reasoning_circuit','record_reasoning_circuit_failure',
  'clear_reasoning_circuit','mint_api_key','verify_api_key_2','revoke_api_key','upsert_api_key_usage','record_feedback','increment_activation_event']);
 if(names.some(name=>!expected.has(name)))throw new Error('Operational grouped SOURCE inventory refused');
 return `DO $build$
DECLARE original record;arg record;fields text;call_arguments text;keys text[];body text;selected text;row_var text;
 declarations text:='';branches text:='';statement text;counted integer:=0;
BEGIN
 FOREACH selected IN ARRAY ARRAY[${names.map(quote).join(',')}] LOOP
  counted:=counted+1;row_var:='typed_'||counted;
  SELECT * INTO STRICT original FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='storage_'||selected;
  fields:='';call_arguments:='p_expected_identity=>expected';keys:=ARRAY[]::text[];
  FOR arg IN SELECT ord,type_oid FROM unnest(coalesce(original.proallargtypes,original.proargtypes::oid[])) WITH ORDINALITY a(type_oid,ord) LOOP
   IF original.proargmodes IS NOT NULL AND original.proargmodes[arg.ord] NOT IN('i','b','v') THEN CONTINUE;END IF;
   IF original.proargnames[arg.ord]='p_expected_identity' THEN CONTINUE;END IF;
   IF original.proargnames[arg.ord] IS NULL THEN RAISE EXCEPTION 'unnamed application domain argument';END IF;
   fields:=fields||CASE WHEN fields='' THEN '' ELSE ',' END||format('%I %s',original.proargnames[arg.ord],format_type(arg.type_oid,NULL));
   keys:=array_append(keys,original.proargnames[arg.ord]);
   call_arguments:=call_arguments||format(',%I=>%I.%I',original.proargnames[arg.ord],row_var,original.proargnames[arg.ord]);
  END LOOP;
  IF octet_length(fields)>32768 THEN RAISE EXCEPTION 'operational argument SOURCE bound';END IF;
  IF fields<>'' THEN
   EXECUTE format('CREATE TYPE keryx_storage.%I AS (%s)','args_'||selected,fields);
   declarations:=declarations||format('%I keryx_storage.%I;',row_var,'args_'||selected);
  END IF;
  IF original.proretset THEN body:=format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) INTO result FROM public.%I(%s) r;',original.proname,call_arguments);
  ELSIF original.prorettype='void'::regtype THEN body:=format('PERFORM public.%I(%s);result:=NULL;',original.proname,call_arguments);
  ELSE body:=format('SELECT to_jsonb(public.%I(%s)) INTO result;',original.proname,call_arguments);END IF;
  branches:=branches||format($branch$WHEN %L THEN
   SELECT coalesce(array_agg(key ORDER BY key),ARRAY[]::text[]) INTO actual FROM jsonb_object_keys(payload) key;
   IF actual IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) FROM unnest(%L::text[]) k) THEN RAISE EXCEPTION 'native application argument keys refused';END IF;
   PERFORM keryx_storage.require_operation(expected,digest,%L);
   %s
   %s
  $branch$,selected,keys,selected,
   CASE WHEN fields='' THEN '' ELSE format('SELECT * INTO %I FROM jsonb_populate_record(NULL::keryx_storage.%I,payload);',row_var,'args_'||selected) END,body);
  IF octet_length(declarations)>32768 OR octet_length(branches)>32768 THEN RAISE EXCEPTION 'operational branch SOURCE bound';END IF;
 END LOOP;
 IF counted<>11 THEN RAISE EXCEPTION 'application operational inventory incomplete';END IF;
 statement:=format($entry$CREATE FUNCTION public.storage_application_operational_write(expected jsonb,digest text,op text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 DECLARE result jsonb;actual text[];%s
 BEGIN
  IF current_setting('transaction_read_only')<>'off' OR payload IS NULL OR jsonb_typeof(payload)<>'object' OR octet_length(payload::text)>65536 THEN RAISE EXCEPTION 'native application read arguments refused';END IF;
  CASE op
   %s
   ELSE RAISE EXCEPTION 'native application operational action refused';
  END CASE;
  IF result IS NOT NULL AND octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native application read result bound';END IF;
  RETURN result;
 END;$fn$;$entry$,declarations,branches);
 IF octet_length(statement)>32768 THEN RAISE EXCEPTION 'operational expanded SOURCE bound';END IF;
 EXECUTE statement;
 REVOKE ALL ON FUNCTION public.storage_application_operational_write(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role,keryx_reader;
 GRANT EXECUTE ON FUNCTION public.storage_application_operational_write(jsonb,text,text,jsonb) TO keryx_app;
END;$build$;
`;
}
