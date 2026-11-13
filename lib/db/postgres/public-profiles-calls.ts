/** Closed action literals and bounded private packets only. */
export const PUBLIC_PROFILE_CALLS=Object.freeze({
 publicProfileRead:{sql:"SELECT public.storage_public_profile_observe($1::jsonb,$2::text,'read',$3::jsonb) AS result",args:1,write:false,bytes:22020096,transaction:true},
 publicProfileSettings:{sql:"SELECT public.storage_public_profile_observe($1::jsonb,$2::text,'settings',$3::jsonb) AS result",args:1,write:false,bytes:16384,transaction:true},
 publicProfileSitemap:{sql:"SELECT public.storage_public_profile_observe($1::jsonb,$2::text,'sitemap',$3::jsonb) AS result",args:1,write:false,bytes:262144,transaction:true},
 publicProfileUpdate:{sql:"SELECT public.storage_public_profile_write($1::jsonb,$2::text,'update',$3::jsonb,$4::jsonb,true) AS result",args:2,write:true,bytes:16384},
 publicProfileUnpublish:{sql:"SELECT public.storage_public_profile_write($1::jsonb,$2::text,'unpublish',$3::jsonb,'null'::jsonb,true) AS result",args:1,write:true,bytes:256},
} as const);
