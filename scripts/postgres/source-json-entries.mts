/** Fixed SOURCE-generated JSON adapters; never a runtime query translator. */
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function nativeApplicationJsonEntrySource(names:readonly string[],write=false):string{
 if(names.length<1||names.length>128||new Set(names).size!==names.length||names.some(n=>!/^[_a-z][_a-z0-9]{0,62}$/.test(n)))throw new Error('Native entry source inventory refused');
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
   IF ${write?"current_setting('transaction_read_only')<>'off'":"current_setting('transaction_read_only')<>'on'"} OR arguments IS NULL OR jsonb_typeof(arguments)<>'object' OR octet_length(arguments::text)>65536 THEN RAISE EXCEPTION 'native application read arguments refused';END IF;
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
