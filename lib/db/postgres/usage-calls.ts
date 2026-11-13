export const USAGE_CALLS=Object.freeze({
 usageWindow:{sql:'SELECT public.storage_public_usage_window($1::jsonb,$2::text,$3::jsonb) AS result',args:1,write:false,bytes:20971520,inputBytes:65536,transaction:true},
 usageSelect:{sql:'SELECT public.storage_public_usage_select($1::jsonb,$2::text,$3::jsonb,$4::integer,$5::boolean,$6::boolean) AS result',args:4,write:false,bytes:8388608,inputBytes:16777216,transaction:true},
 usageFinish:{sql:'SELECT public.storage_public_usage_finish($1::jsonb,$2::text,$3::jsonb,$4::integer,$5::boolean,$6::boolean) AS result',args:4,write:false,bytes:41943040,inputBytes:16777216,transaction:true},
} as const);
