export const ACCEPTANCE_CALLS=Object.freeze({
 acceptanceRead:{sql:"SELECT public.storage_acceptance_observe($1::jsonb,$2::text,'read',jsonb_build_object('owner',$3::text,'network',$4::text,'id',$5::text)) AS result",args:3,write:false,bytes:12582912,transaction:true},
 acceptancePublic:{sql:"SELECT public.storage_acceptance_observe($1::jsonb,$2::text,'public',jsonb_build_object('network',$3::text,'id',$4::text)) AS result",args:2,write:false,bytes:4096,transaction:true},
 acceptanceMetrics:{sql:"SELECT public.storage_acceptance_observe($1::jsonb,$2::text,'metrics',jsonb_build_object('network',$3::text)) AS result",args:1,write:false,bytes:262144,transaction:true},
 acceptanceSubmit:{sql:'SELECT public.storage_acceptance_submit($1::jsonb,$2::text,$3::text,$4::text,$5::text,$6::jsonb,$7::jsonb,$8::text) AS result',args:6,write:true,bytes:12582912},
} as const);
