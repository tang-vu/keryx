/** Closed workspace operations on the same bounded channel. */
export const WORKSPACE_CALLS=Object.freeze({
 bibliographyList:{sql:'SELECT public.storage_bibliography_list($1::jsonb,$2::text,$3::text) AS result',args:1,write:false,bytes:65536,transaction:true},
 bibliographyRead:{sql:'SELECT public.storage_bibliography_read($1::jsonb,$2::text,$3::text) AS result',args:1,write:false,bytes:1049600,transaction:true},
 bibliographyCreate:{sql:"SELECT public.storage_bibliography_mutation($1::jsonb,$2::text,'create',$3::text,$4::text) AS result",args:2,write:true,bytes:2048,inputBytes:4194304},
 bibliographyReplace:{sql:"SELECT public.storage_bibliography_mutation($1::jsonb,$2::text,'replace',$3::text,$4::text) AS result",args:2,write:true,bytes:2048,inputBytes:4194304},
 bibliographyRevoke:{sql:"SELECT public.storage_bibliography_mutation($1::jsonb,$2::text,'revoke',$3::text,$4::text) AS result",args:2,write:true,bytes:128},
 watchList:{sql:"SELECT public.storage_watch_read($1::jsonb,$2::text,'list',$3::jsonb,NULL) AS result",args:1,write:false,bytes:16793600,transaction:true},
 watchRead:{sql:"SELECT public.storage_watch_read($1::jsonb,$2::text,'read',$3::jsonb,$4::text) AS result",args:2,write:false,bytes:525312,transaction:true},
 watchCompareSwap:{sql:'SELECT public.storage_watch_compare_swap($1::jsonb,$2::text,$3::jsonb,$4::text) AS result',args:2,write:true,bytes:256,inputBytes:2097152},
});
