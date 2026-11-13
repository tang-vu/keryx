/** Fresh SOURCE compilation only. The runtime sends fixed literal actions to a
 * small closed CASE group; it cannot supply SQL, a function name or a callback. */
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
export function nativeApplicationReadGroupsSource(input:readonly string[]):string{
 if(!Array.isArray(input)||input.length<1||input.length>128||new Set(input).size!==input.length||input.some(n=>typeof n!=='string'||!/^[_a-z][_a-z0-9]{0,62}$/.test(n)))throw Error('Native read group SOURCE inventory refused');
 const names=[...input].sort(),groups=Array.from({length:Math.ceil(names.length/8)},(_,i)=>names.slice(i*8,i*8+8));
 return groups.map((group,index)=>`DO $build$
DECLARE original record;arg record;fields text;call_arguments text;keys text[];body text;selected text;row_var text;declarations text:='';branches text:='';counted integer:=0;
BEGIN
 FOREACH selected IN ARRAY ARRAY[${group.map(quote).join(',')}] LOOP
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
  IF fields<>'' THEN
   EXECUTE format('CREATE TYPE keryx_storage.%I AS (%s)','args_'||selected,fields);
   declarations:=declarations||format('%I keryx_storage.%I;',row_var,'args_'||selected);
  END IF;
  IF original.proretset THEN body:=format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) INTO result FROM public.%I(%s) r;',original.proname,call_arguments);
  ELSIF original.prorettype='void'::regtype THEN RAISE EXCEPTION 'read domain returned void';
  ELSE body:=format('SELECT to_jsonb(public.%I(%s)) INTO result;',original.proname,call_arguments);END IF;
  branches:=branches||format($branch$WHEN %L THEN
   SELECT coalesce(array_agg(key ORDER BY key),ARRAY[]::text[]) INTO actual FROM jsonb_object_keys(arguments) key;
   IF actual IS DISTINCT FROM (SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) FROM unnest(%L::text[]) k) THEN RAISE EXCEPTION 'native application argument keys refused';END IF;
   PERFORM keryx_storage.require_operation(expected,digest,%L);
   %s
   %s
  $branch$,selected,keys,selected,
   CASE WHEN fields='' THEN '' ELSE format('SELECT * INTO %I FROM jsonb_populate_record(NULL::keryx_storage.%I,arguments);',row_var,'args_'||selected) END,body);
 END LOOP;
 IF counted<>${group.length} THEN RAISE EXCEPTION 'application read group inventory incomplete';END IF;
 EXECUTE format($entry$CREATE FUNCTION public.storage_application_read_group_${index}(expected jsonb,digest text,selected_action text,arguments jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 DECLARE result jsonb;actual text[];%s
 BEGIN
  IF current_setting('transaction_read_only')<>'on' OR arguments IS NULL OR jsonb_typeof(arguments)<>'object' OR octet_length(arguments::text)>65536 THEN RAISE EXCEPTION 'native application read arguments refused';END IF;
  CASE selected_action
   %s
   ELSE RAISE EXCEPTION 'native application read action refused';
  END CASE;
  IF result IS NOT NULL AND octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'native application read result bound';END IF;
  RETURN result;
 END;$fn$;$entry$,declarations,branches);
 REVOKE ALL ON FUNCTION public.storage_application_read_group_${index}(jsonb,text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.storage_application_read_group_${index}(jsonb,text,text,jsonb) TO keryx_app,keryx_reader;
END;$build$;`).join('\n');
}
