/** Literal fixed actions only; no caller action/SQL/function selector escapes. */
export const ACCOUNT_CALLS=Object.freeze({
 accountHistory:{sql:'SELECT public.storage_account_history($1::jsonb,$2::text,$3::jsonb,$4::jsonb,$5::boolean,$6::bigint) AS result',args:4,write:false,bytes:41943040,inputBytes:262144,transaction:true},
 accountOffer:{sql:"SELECT public.storage_account_observe($1::jsonb,$2::text,'offer',$3::jsonb) AS result",args:1,write:false,bytes:65536,transaction:true},
 accountResolve:{sql:"SELECT public.storage_account_observe($1::jsonb,$2::text,'resolve',$3::jsonb) AS result",args:1,write:false,bytes:65536,transaction:true},
 accountCurrent:{sql:"SELECT public.storage_account_observe($1::jsonb,$2::text,'current',$3::jsonb) AS result",args:1,write:false,bytes:65536,transaction:true},
 accountResume:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'resume',$3::jsonb) AS result",args:1,write:true,bytes:65536},
 accountIssue:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'issue',$3::jsonb) AS result",args:1,write:true,bytes:65536},
 accountTake:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'take',$3::jsonb) AS result",args:1,write:true,bytes:65536},
 accountComplete:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'complete',$3::jsonb) AS result",args:1,write:true,bytes:65536},
 accountUnlink:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'unlink',$3::jsonb) AS result",args:1,write:true,bytes:65536},
 accountRevoke:{sql:"SELECT public.storage_account_write($1::jsonb,$2::text,'revoke',$3::jsonb) AS result",args:1,write:true,bytes:65536},
} as const);
