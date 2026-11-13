/** Fresh independent SOURCE composition only; no runtime installation or admission. */
import { nativeApplicationReadGroupsSource } from "./source-json-read-groups.mts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { nativeApplicationFinancialReferenceSource } from "./application-reference-source.mts";
import { APPLICATION_READ_CALLS,APPLICATION_READ_OPERATIONS } from "../../lib/db/postgres/application-read-calls";
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
  for(const [index,name] of [...names].sort().entries()){
    const call=APPLICATION_READ_CALLS[APPLICATION_READ_OPERATIONS[name as keyof typeof APPLICATION_READ_OPERATIONS]];
    const expected=`SELECT public.storage_application_read_group_${Math.floor(index/8)}($1::jsonb,$2::text,'${name}',$3::jsonb) AS result`;
    if(call.sql!==expected||call.args!==1||call.write!==false||call.bytes!==4194304||call.transaction!==true)throw Error('Application read group fixed call changed');
  }
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
${nativeApplicationReadGroupsSource(names)}
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA keryx_storage FROM PUBLIC,keryx_app,keryx_reader;
RESET ROLE;
`;
  return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Read-domain source composition only; application writes, remaining current ports and installed provenance are not admitted.'});
}
