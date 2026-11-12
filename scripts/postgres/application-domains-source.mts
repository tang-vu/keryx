/** Fresh independent SOURCE composition only; no runtime installation or admission. */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { nativeApplicationFinancialReferenceSource } from "./application-reference-source.mts";
import { APPLICATION_READ_OPERATIONS } from "../../lib/db/postgres/application-read-calls";
const quote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
const read=(name:string)=>readFileSync(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
export function nativeApplicationDomainsReferenceSource(){
  const financial=nativeApplicationFinancialReferenceSource();
  const inventory=read('0076_enrolled_storage_owner_cutover.sql').match(/insert into keryx_storage.operations\(operation,relations,real_only,read_only\) values\n([\s\S]*?);/);
  if(!inventory)throw new Error('Application operation source unavailable');
  let direct=read('0074_enrolled_storage_domain_apis.sql');
  const directEnd=direct.indexOf('-- Only these newly installed APIs are granted;');
  if(directEnd<0)throw new Error('Application API source shape refused');direct=direct.slice(0,directEnd);
  let wrappers=read('0075_enrolled_storage_domain_wrappers.sql');
  const wrapperEnd=wrappers.indexOf('-- Only the protected startup path receives bounded encrypted cache rows.');
  if(wrapperEnd<0)throw new Error('Application wrapper source shape refused');wrappers=wrappers.slice(0,wrapperEnd);
  const strip=(s:string)=>s.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'');
  const names=Object.keys(APPLICATION_READ_OPERATIONS);
  const financialNames=[...financial.sql.matchAll(/CREATE FUNCTION public\.(storage_[a-z0-9_]+)\(/g)].map(m=>m[1]);
  if(financialNames.length!==26||names.length!==78)throw new Error('Application source inventory changed; review required');
  const sql=financial.sql+`
SET ROLE keryx_owner;
CREATE FUNCTION keryx_storage.read_operation(expected jsonb,selected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 -- Only private, ungranted domain helpers call this. The outer fixed native
 -- entrypoint checks its caller-pinned source digest in the SAME read-only tx.
 IF current_setting('transaction_read_only')<>'on' OR session_user NOT IN('keryx_app','keryx_reader')
  OR expected IS DISTINCT FROM (SELECT identity FROM keryx_storage.identity WHERE singleton)
  OR (SELECT mode FROM keryx_storage.control WHERE singleton) IS DISTINCT FROM 'active'
  OR NOT EXISTS(SELECT 1 FROM keryx_storage.operations WHERE operation=selected AND read_only)
 THEN RAISE EXCEPTION 'native application nested read refused';END IF;
END;$$;
CREATE FUNCTION keryx_storage.enter_operation(expected jsonb,selected text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'application writes are not qualified';END;$$;
`+inventory[0]+"\n"+strip(direct)+"\n"+strip(wrappers)+`

DO $$ DECLARE f record;BEGIN
 FOR f IN SELECT p.oid::regprocedure AS signature FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
  AND NOT p.proname=ANY(ARRAY[${financialNames.map(quote).join(',')}]) LOOP
  EXECUTE 'REVOKE ALL ON FUNCTION '||f.signature||' FROM PUBLIC,anon,authenticated,service_role,keryx_app,keryx_reader';
 END LOOP;
END;$$;
-- Emit fixed JSON argument adapters from this freshly built SOURCE schema. The
-- target is independently installed from the same source and compared afterward.
DO $build$ DECLARE original record;arg record;fields text;arguments text;keys text[];body text;selected text;counted integer:=0;
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
  ELSIF original.prorettype='void'::regtype THEN RAISE EXCEPTION 'read domain returned void';
  ELSE body:=format('SELECT to_jsonb(public.%I(%s)) INTO result;',original.proname,arguments);END IF;
  EXECUTE format($entry$CREATE FUNCTION public.%I(expected jsonb,digest text,arguments jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
  DECLARE result jsonb;actual text[];%s
  BEGIN
   IF current_setting('transaction_read_only')<>'on' OR arguments IS NULL OR jsonb_typeof(arguments)<>'object' OR octet_length(arguments::text)>65536 THEN RAISE EXCEPTION 'native application read arguments refused';END IF;
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
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(jsonb,text,jsonb) TO keryx_app,keryx_reader','storage_application_'||selected);
  counted:=counted+1;
 END LOOP;
 IF counted<>78 THEN RAISE EXCEPTION 'application read inventory incomplete';END IF;
END;$build$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
`;
  return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Read-domain source composition only; application writes, remaining current ports and installed provenance are not admitted.'});
}
