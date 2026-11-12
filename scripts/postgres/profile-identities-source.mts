/** Fixed native identity SOURCE, independent of ordinary/Supabase admission. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { nativePrivateProfilesSource } from './private-profiles-source.mts';
const once=(source:string,before:string,after:string)=>{if(source.split(before).length!==2)throw new Error('Profile identity SOURCE changed; review required');return source.replace(before,()=>after);};
export function nativeProfileIdentitiesSource(){
 const base=nativePrivateProfilesSource(),source=readFileSync(new URL('../../supabase/migrations/0085_profile_verified_identities.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const start=source.indexOf('create function public.profile_identities_ordinary_v1('),end=source.indexOf('revoke all on function public.profile_identities_ordinary_v1(');
 if(start<0||end<=start||end-start>16384)throw new Error('Profile identity SOURCE unavailable');
 let helpers=source.slice(start,end).trim();
 const names=['profile_identities_ordinary_v1','profile_identity_active_v1','profile_identities_list_v1','profile_identity_begin_v1','profile_identity_consume_v1','profile_identity_complete_v1','profile_identity_unlink_v1'];
 for(const name of names)helpers=helpers.replaceAll('public.'+name,'keryx_storage.'+name);
 helpers=helpers.replaceAll('set search_path=pg_catalog,public','SET search_path=pg_catalog,pg_temp');
 helpers=once(helpers,'perform public.private_profiles_ordinary_v1(p_wallet);','PERFORM keryx_storage.profile_identity_context(p_wallet);');
 helpers=once(helpers,`to_char(verified_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,'verified_at');
 // The current SQLite/native contract stores the exact ISO wire as TEXT.
 helpers=helpers.replaceAll('verified_at=v_verified_at',`verified_at=to_char(v_verified_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`);
 const template=readFileSync(new URL('../../ops/keryx-postgres/profile-identities.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
 const sql=base.sql+'\n'+once(template,'{{IDENTITY_HELPERS}}',helpers);
 return Object.freeze({sql,sha256:createHash('sha256').update(sql).digest('hex'),limitations:'Native profile identity protocol; installed runtime, other user domains and full data cutover remain unqualified.'});
}
