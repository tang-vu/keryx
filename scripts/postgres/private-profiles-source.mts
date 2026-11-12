/** Fixed native profile SOURCE; never an ordinary/Supabase runtime admission. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativeBoundedReadApplicationSource } from './bounded-read-source.mts';
const once=(value:string,before:string,after:string)=>{if(value.split(before).length!==2)throw new Error('Private profile SOURCE changed; review required');return value.replace(before,()=>after);};
export function nativePrivateProfilesSource(){
 const base=nativeBoundedReadApplicationSource(),source=readFileSync(new URL('../../supabase/migrations/0083_private_profiles.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('create function public.private_profile_update_v1('),end=source.indexOf('create function public.private_profile_delete_v1(');
 if(start<0||end<=start||end-start>16384)throw new Error('Private profile validator SOURCE unavailable');
 let validation=source.slice(start,end).trim();
 const stamp="to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')";
 validation=once(validation,'create function public.private_profile_update_v1(','CREATE FUNCTION keryx_storage.private_profile_update(');
 validation=once(validation,'set search_path=pg_catalog,public','SET search_path=pg_catalog,pg_temp');
 validation=once(validation,'max_units integer;','max_units integer;native_now text:='+stamp+';');
 validation=once(validation,'perform public.private_profiles_ordinary_v1(p_wallet);','PERFORM keryx_storage.private_profile_context(p_wallet);');
 validation=once(validation,'private_profiles(wallet,handle,display_name,bio,purpose,links) values','private_profiles(wallet,handle,display_name,bio,purpose,links,created_at,updated_at) values');
 validation=once(validation,"p_profile->>'purpose',p_profile->'links')","p_profile->>'purpose',(p_profile->'links')::text,native_now,native_now)");
 validation=once(validation,'updated_at=now()','updated_at=native_now');
 validation=once(validation,'return public.private_profile_record_v1(p_wallet);','RETURN keryx_storage.private_profile_record(p_wallet);');
 const template=readFileSync(new URL('../../ops/keryx-postgres/private-profiles.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const sql=base.sql+'\n'+once(template,'{{VALIDATED_PROFILE_UPDATE}}',validation);
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Private profile protocol only; other user-domain ports, complete runtime, full-data materialization and production cutover remain unqualified.'});
}
